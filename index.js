/*
 *  CA350 Control for MQTT / Home Assistant written in NodeJS
 *
 *  Inspired by 
 *  - https://github.com/adorobis/hacomfoairmqtt 
 *  - https://github.com/AlbertHakvoort/StorkAir-Zehnder-WHR-930-Domoticz-MQTT
 *  - https://github.com/iobroker-community-adapters/ioBroker.comfoair
 * 
 */

// Logging
const log = require('simple-node-logger').createSimpleLogger();
var debug = true;

if(debug)log.setLevel('debug');
// Serial Connection
const SerialPort = require('serialport')
const InterByteTimeout = require('@serialport/parser-inter-byte-timeout');
var serialDevice = "/dev/ttyUSB0"
const port = new SerialPort(serialDevice, {
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  autoOpen: false,
  flowControl: false
});

const parser = port.pipe(new InterByteTimeout({
  interval: 20
}));

// MQTT
var mqttHost = "10.0.0.88";
var mqttUser = "mosquito";
var mqttPass = "1337";

var mqtt = require('mqtt')
var mqttOptions = {  
    port: 1883,
    clientId: 'ca350_' + Math.random().toString(16).substr(2, 8),
    username: mqttUser,
    password: mqttPass,
  };

var mqttClient = mqtt.connect("mqtt://" + mqttHost, mqttOptions);
log.info("CA350 Controller")

mqttClient.on('connect', function () {
    
    log.info("Connected to MQTT Broker");  
    InitSerial();
    
    
    mqttClient.subscribe('comfoair/vent/fan/set');
    mqttClient.subscribe('comfoair/temp/comfort/set');
    mqttClient.subscribe('comfoair/vent/set');
    mqttClient.subscribe('comfoair/off');
    mqttClient.subscribe('comfoair/filter/reset');
})


// CA350

var CA350 = [];

// Funktionen
CA350.Funcs = [];
CA350.Funcs.ComfortTemp   = [0x07, 0xF0, 0x00, 0xD3, 0x01, 0x14, 0x48, 0x07, 0x0F]; //Komforttemperatur setzen
CA350.Funcs.Vent          = [0x07, 0xF0, 0x00, 0xCF, 0x09, 0x0F, 0x28, 0x46, 0x0F, 0x28, 0x46, 0x5A, 0x5A, 0x00, 0x00, 0x07, 0x0F]; // Ventilatorstufen setzen
CA350.Funcs.VentLevel     = ['ABLabw', 'ABL1', 'ABL2', 'ZULabw', 'ZUL1', 'ZUL2', 'ABL3', 'ZUL3'];
CA350.Funcs.VentFetched   = false;
CA350.Funcs.SelfCheck     = [0x07, 0xF0, 0x00, 0xDB, 0x04, 0x00, 0x00, 0x01, 0x00, 0x8d, 0x07, 0x0F]; // Selbsttest durchführen
CA350.Funcs.ShouldDelay   = [0x07, 0xF0, 0x00, 0xCB, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x99, 0x07, 0x0F];
CA350.Funcs.Reset         = [0x07, 0xF0, 0x00, 0xDB, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x0F];
CA350.Funcs.SetRS232      = [0x07, 0xF0, 0x00, 0x9B, 0x01, 0x02, 0x4b, 0x07, 0x0F];
CA350.Funcs.SetLogmode    = [0x07, 0xF0, 0x00, 0x9B, 0x01, 0x04, 0x4d, 0x07, 0x0F];
CA350.Funcs.SetMasterMode = [0x07, 0xF0, 0x00, 0x9B, 0x01, 0x03, 0x4c, 0x07, 0x0F];
CA350.Funcs.SetCCEaseMode = [0x07, 0xF0, 0x00, 0x9B, 0x01, 0x00, 0x49, 0x07, 0x0F];

// Readings
CA350.Readings = [];
CA350.Readings.Temp         = [0x07, 0xF0, 0x00, 0xD1, 0x00, 0x7E, 0x07, 0x0F];
CA350.Readings.VentStatus   = [0x07, 0xF0, 0x00, 0xCD, 0x00, 0x7A, 0x07, 0x0F];
CA350.Readings.RunningHour  = [0x07, 0xF0, 0x00, 0xDD, 0x00, 0x8A, 0x07, 0x0F];
CA350.Readings.BypassStatus = [0x07, 0xF0, 0x00, 0x0D, 0x00, 0xBA, 0x07, 0x0F];
CA350.Readings.Delay        = [0x07, 0xF0, 0x00, 0xC9, 0x00, 0x76, 0x07, 0x0F];
CA350.Readings.Errors       = [0x07, 0xF0, 0x00, 0xD9, 0x00, 0x86, 0x07, 0x0F];
CA350.Readings.Enthalpie    = [0x07, 0xF0, 0x00, 0x97, 0x00, 0x44, 0x07, 0x0F];

// Fan States
CA350.FanState = [];
CA350.FanState.Off    = [0x07, 0xF0, 0x00, 0x99, 0x01, 0x01, 0x48, 0x07, 0x0F];
CA350.FanState.Low    = [0x07, 0xF0, 0x00, 0x99, 0x01, 0x02, 0x49, 0x07, 0x0F];
CA350.FanState.Middle = [0x07, 0xF0, 0x00, 0x99, 0x01, 0x03, 0x4A, 0x07, 0x0F];
CA350.FanState.High   = [0x07, 0xF0, 0x00, 0x99, 0x01, 0x04, 0x4B, 0x07, 0x0F];
var hexout;

CA350.Enthalpie = false;

function InitSerial() {
  port.open(function(err) {
    if (err) {
      log.error('Error opening port: ' + err.message);
    }
  })
  
}



port.on('open', function() {
  log.info('Connected to serial port');


  // Initial Readings
  ReadAll();
  setInterval(ReadAll, 20000);
  callComfoAir(CA350.Readings.Errors);
  // MQTT Listener
  mqttClient.on('message', (topic, message) => {
    console.log(topic);
    var msg = message.toString();
    console.log("[" + msg + "]")
    switch (topic) {
      case 'comfoair/vent/fan/set':
        var lvl = parseInt(message.toString());
        console.log("right")
        switch(lvl){
          case 1:
          log.debug("Setting Off")
          callComfoAir(CA350.FanState.Off)
          break;
          case 2:
          log.debug("Setting Low")
          callComfoAir(CA350.FanState.Low)
          break;
          case 3:
          log.debug("Setting Middle")
          callComfoAir(CA350.FanState.Middle)
          break;
          case 4:
          log.debug("Setting High")
          callComfoAir(CA350.FanState.High)
          break;
        }
      break;
      case 'comfoair/temp/comfort/set':
        setcomfotemp[5] = ((parseInt(message) + 20) * 2);
        setcomfotemp[6] = parseInt(checksumcmd(setcomfotemp), 16);
      break;
      case 'comfoair/off':
        
      break;
      case 'comfoair/vent/set':
        var msg = JSON.parse(message);
        setVentLevel(msg.state, msg.percent);
      break;
      case 'comfoair/filter/reset':
        log.debug("Resetting filter")
        var setreset = [0x07, 0xF0, 0x00, 0xDB, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x0F]
        setreset[8] = 1;
        setreset[9] = parseInt(checksumcmd(setreset), 16);
        callComfoAir(setreset);
      break;
    }

  })
  parser.on('data', function(data) {
    var buff = Buffer.from(data);
    var buffarr = [...buff];
    try {
      if (buffarr.length > 3) {
        if (buffarr[0] == 7 && buffarr[1] == 243 && buffarr[buffarr.length - 3] == parseInt(checksumcmd(buff.slice(2)), 16)) {
          processReadings(buffarr);
        }
      } else {
        processData(buff, hexout)
      }
    } catch (e) {
      log.warn("Client-Data - Fehler" + e);
    }
  });

  function ReadAll(){
    setTimeout(callComfoAir, 1000, CA350.Readings.Enthalpie)
    setTimeout(callComfoAir, 3000, CA350.Readings.Temp)
    setTimeout(callComfoAir, 6000, CA350.Readings.VentStatus)
    setTimeout(callComfoAir, 9000, CA350.Readings.Errors)
    setTimeout(callComfoAir, 12000, CA350.Readings.Delay)
    setTimeout(callComfoAir, 15000, CA350.Readings.BypassStatus)
    setTimeout(callComfoAir, 18000, CA350.Readings.RunningHour)
  }

  function callComfoAir(xout){
    hexout = xout;
    port.write(xout);
    
  }
  function setVentLevel(state, percent) {
    if(CA350.Funcs.VentFetched){
      var copyVent = CA350.Funcs.Vent;
      var setventl = CA350.Funcs.VentLevel.indexOf(state);
  
      copyVent[setventl + 5] = percent;
      copyVent[14] = parseInt(checksumcmd(copyVent), 16);

      log.debug(state + " neu " + copyVent[setventl + 5] + "%");
      callComfoAir(CA350.Funcs.Vent);
    }else{
      log.debug("Old data not readed, dont change");
    }
  }
});


function checksumcmd(csdata) {
  try {
    var checksum = 0;
    for (var i = 2; i < (csdata.length - 3); i++) {
      if (i > 5 && csdata[i] == 7 && csdata[i - 1] == 7) {
        log.debug("doppelte '07'");
      } else {
        checksum = checksum + csdata[i]
      }
    }
    checksum = ((checksum + 173).toString(16)).slice(-2);
    return checksum;
 
  } catch (e) {
    log.warn("ChecksumCmd - Fehler: " + e)
  }
} //end checksumcmd

function processData(buff,hexout) {
  if (buff.toString('hex') == "07f3") {
    log.debug("ACK erhalten");
    log.debug('Data received (hex): ' + buff.toString('hex'));
    log.debug(hexout);
    switch (hexout[3]) {
      case 153: // Setze Lüfterstufe
        mqttClient.publish('comfoair/vent/fan', (hexout[5]-1).toString())
        log.debug("Fan Stufe: " + (parseInt(hexout[5])-1));
        break;
      case 211: // Setze Comfort Temperatur
        
        break;
      case 219: 
        if (hexout[5] == 1) { // Störungen züruckgesetzt
          log.debug("Störungen zurückgesetzt");
        }
        if (hexout[6] == 1) { // Einstellungen züruckgesetzt
          log.debug("Einstellungen zurückgesetzt");
        }
        if (hexout[7] == 1) { // Selbsttest
          log.debug("Selbsttest gestartet");
        }
        if (hexout[8] == 1) { // Filter Betriebsstunden zurückgesetzt
          log.debug("Betriebsstunden Filter zurückgesetzt");
        }
        break;
        case 207: // Ventilatorsstufen setzen
          
          log.debug("Ventilationsstufen gesetzt");
        break;
      }
  }
}

function processReadings(buffarr) {
  var cmd = parseInt(buffarr[5]);
  
  switch (cmd) {
    case 210: // Temperatur
      log.debug("==== TEMP ====")
      log.debug("Aussen Temperatur:   " + ((buffarr[8] / 2) - 20))
      log.debug("Zuluft Temperatur:   " + ((buffarr[9] / 2) - 20))
      log.debug("Abluft Temperatur:   " + ((buffarr[10] / 2) - 20))
      log.debug("Fortluft Temperatur: " + ((buffarr[11] / 2) - 20))
      log.debug("Comfort Temperatur:  " + ((buffarr[7] / 2) - 20))
      mqttClient.publish('comfoair/temp/outside', ((buffarr[8] / 2) - 20).toString())
      mqttClient.publish('comfoair/temp/supply', ((buffarr[9] / 2) - 20).toString())
      mqttClient.publish('comfoair/temp/exhaust', ((buffarr[10] / 2) - 20).toString())
      mqttClient.publish('comfoair/temp/return', ((buffarr[11] / 2) - 20).toString())
      mqttClient.publish('comfoair/temp/comfort', ((buffarr[7] / 2) - 20).toString())
    break;
    case 206: // Ventilator Status
      log.debug("=== VENT ====");
      log.debug("ABLabw:  " + buffarr[7]);
      log.debug("ABL1:    " + buffarr[8])
      log.debug("ABL2:    " + buffarr[9])
      log.debug("ZULabw:  " + buffarr[10])
      log.debug("ZUL1:    " + buffarr[11])
      log.debug("ZUL2:    " + buffarr[12])
      log.debug("ventABL: " + buffarr[13])
      log.debug("ventZUL: " + buffarr[14])
      log.debug("Lüfter   " + (buffarr[15] - 1))
      log.debug("ABL3:    " + buffarr[17])
      log.debug("ZUL3:    " + buffarr[18])
      for (var i = 5; i < 11; i++) {
        CA350.Funcs.Vent[i] = buffarr[i + 2];
      }
      CA350.Funcs.Vent[11] = buffarr[17];
      CA350.Funcs.Vent[12] = buffarr[18];
      log.debug("Current Vent Level: " + CA350.Funcs.Vent);
      CA350.Funcs.VentFetched = true;
      mqttClient.publish('comfoair/vent/ablabw', buffarr[7].toString())
      mqttClient.publish('comfoair/vent/abl1', buffarr[8].toString())
      mqttClient.publish('comfoair/vent/abl2', buffarr[9].toString())
      mqttClient.publish('comfoair/vent/abl3', buffarr[17].toString())
      mqttClient.publish('comfoair/vent/zulabw', buffarr[10].toString())
      mqttClient.publish('comfoair/vent/zul1', buffarr[11].toString())
      mqttClient.publish('comfoair/vent/zul2', buffarr[12].toString())
      mqttClient.publish('comfoair/vent/zul3', buffarr[18].toString())
      mqttClient.publish('comfoair/vent/ventabl', buffarr[13].toString())
      mqttClient.publish('comfoair/vent/ventzul', buffarr[14].toString())
      mqttClient.publish('comfoair/vent/fan', (buffarr[15]).toString())
      mqttClient.publish('comfoair/status', "on")

    break;
    case 222: // Betriebsstunden
      mqttClient.publish('comfoair/filter/hours', parseInt((buffarr[22].toString(16).padStart(2, '0') + buffarr[23].toString(16).padStart(2, '0')), 16).toString());
    break;
    case 14: // Bypass Status in %
      log.debug("=== BYPASS ====")
      log.debug("Bypass: " + buffarr[7])
      mqttClient.publish('comfoair/bypass/status', buffarr[7].toString())
    break;
    case 224: // Bypass 224 in %
      log.debug("=== BYPASS ====")
      log.debug("Bypass 224: " + buffarr[10])
      mqttClient.publish('comfoair/bypass/status', buffarr[10].toString())
      if(buffarr[10].toString() == 1){
        mqttClient.publish('comfoair/bypass/mode', "Winter")
      }else{
        mqttClient.publish('comfoair/bypass/mode', "Summer")
      }
    break;
    case 202: // Filter Status in Wochen
      log.debug("=== Filter ====")
      log.debug("Filter Wochen: " + buffarr[11])
      mqttClient.publish('comfoair/filter/weeks', buffarr[11].toString())
    break;
    
    case 218: // Störmeldungen
      if(buffarr[15] == 0)
      {
        mqttClient.publish('comfoair/filter/status', "OK");
      }else if(buffarr[15] == 1){
        mqttClient.publish('comfoair/filter/status', "Full");
      }else{
        mqttClient.publish('comfoair/filter/status', "Unknown");
      }
      
    break;
    case 214:
      enthalpieCheck(buffarr);
    break;
    case 152:
      if(CA350.Enthalpie){
        log.debug("==== ENTHALPIE ====");
        log.debug("Enthalpie Temp       : " + ((buffarr[7] / 2) - 20));
        log.debug("Enthalpie Humidity   : " + (buffarr[8]))
        log.debug("Enthalpie Koeffizient: " + (buffarr[11]))
      }
    break;
    case 226:
      log.debug(" : lese Frostschutzwerte - ohne schreiben");
    break;
    case 236:
      log.debug(" : lese EWT/Nachheizung - ohne schreiben");
    break;
  }
}

function enthalpieCheck(buffarr) {
  switch (buffarr[15]) {
    case 0:
      return "Kein Enthalpietauscher"
      break;

    case 1:
      return "Enthalpietauscher mit Sensor vorhanden";
      CA350.Enthalpie = true;
      break;

    case 2:
      return "Enthalpietauscher ohne Sensor";
      break;
  }
}

