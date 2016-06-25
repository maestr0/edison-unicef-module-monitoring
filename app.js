var SegfaultHandler = require('segfault-handler');
SegfaultHandler.registerHandler("crash.log");

// ONLY INITIALIZATION BEFORE OTHER ELEMENTS
var SerialPort = require("serialport").SerialPort;
var serialPath = "/dev/ttyMFD2";
var serialPort = new SerialPort(serialPath, {
    baudrate: 115200
});

var appVersion = 26;
var startDate = new Date();
var lastSleep = new Date();


var mraa = require('mraa');

var appState = "initialize";


// -------------------------------------
/*fs = require('fs');
//winston = require('./log.js');
winston = require('winston');
var rebootCount = (process.env.REBOOT_COUNT || "RC");
var loggerFilePath = (process.env.MODULE_PACKAGES_DIR || "/node_app_slot") + "/logs/" + rebootCount + "_monitoring.log";

winston.add(require('winston-daily-rotate-file'), {
    filename: loggerFilePath,
    handleExceptions: true,
    humanReadableUnhandledException: true
});
winston.info("Logging to file " + loggerFilePath);*/
// -------------------------------------

moduleDataPath = process.env.MODULE_DATA_DIR || "/media/sdcard/data";
scriptsPath = process.env.SCRIPTS || "/home/root/scripts";
serialNumber = process.env.SERIAL_NUMBER || "mocked-serial-no";
rebootCount = process.env.REBOOT_COUNT || "HARDCODED_VALUE";

console.log("before env variable");
rotationalSpeed  = process.env.ROTATION_SPEED || 0x10; // up to 127
rotationDuration = process.env.ROTATION_DURATION || 0x07; // up to 127
console.log("After env variable");


var dataFileNamePrefix = generateID();

var express = require('express');
var sdCard = require('fs');


var touchSensorDriver = require('jsupm_mpr121'); // GLOBAL variable
var IMUClass = require('jsupm_lsm9ds0');  // Instantiate an LSM9DS0 using default parameters (bus 1, gyro addr 6b, xm addr 1d)
var exec = require('child_process').exec;

var alreadyRecordingMovie = false;
var moduleisRotating = false;
var durationInHorizontalPosition = 0;

var capacitiveSensorInterruptPin = 8;
var voltageBoostPin = 9;
var moduleIsBeingTransportedInterruptPin = 10;
var horizontalPositionInterruptPin = 11;
var GyroscopeInterruptPin = 12;

var pushButtonLightPin = 13;
var pushButtonLight = new mraa.Gpio(pushButtonLightPin);

var gyrocsopeInterrupt ;
var horizontalPositionInterrupt ;

appMode = process.env.NODE_ENV || "development";

appMode = "development";

videoDuration = (appMode === "production") ? "32" : "5";
delayBeforeActivatingAllSensors = (appMode === "production") ? /*(8 * 60 * 1000)*/ 1000 : 1000;
delayBeforeAccessPointTimeout = (appMode === "production") ? (22 * 60 * 1000) : (2 * 60 * 1000);

//winston.info("new file prefix: " + dataFileNamePrefix);

var weAreRotating = 0x60; //0x40 is interrupt triggered
var touchDataID = 0;
var motionDataID = 0;

var ErrorLogFileName = moduleDataPath + "/error.log";
var templateDataLogTouch = serialNumber + ",C,";
var templateDataLogMotion = serialNumber + ",I,";

var powerBoost;
var touchSensor;
var soapSensorIsDamaged = false;
var IMUSensorIsDamaged = false;
gyroAccelCompass = "not initialized" ; //= new IMUClass.LSM9DS0()  ; //GLOBAL VARIABLE
var app;

var soapStatusText = "";
var timeWithUnsavedTouch = 0;
var systemRefreshFrequency = 200; //ms

var appStateCountdown = 15 *  (1000/systemRefreshFrequency);
var horizontalPositionCheckCountdown = 0.5 * (1000/systemRefreshFrequency);
var sleepModeCheckCountdown = 45 * (1000/systemRefreshFrequency);

var xAcceleroValue = new IMUClass.new_floatp();
var yAcceleroValue = new IMUClass.new_floatp();
var zAcceleroValue = new IMUClass.new_floatp();
var currentTime;

var xGyroAxis;
var yGyroAxis;
var zGyroAxis;
var gyroscopeDataText = "";

function getGyroscopeData(currentTime){
    gyroAccelCompass.updateGyroscope();
    xGyroAxis = new IMUClass.new_floatp();
    yGyroAxis = new IMUClass.new_floatp();
    zGyroAxis = new IMUClass.new_floatp();
    gyroAccelCompass.getGyroscope(xGyroAxis, yGyroAxis, zGyroAxis);

    gyroscopeDataText += templateDataLogMotion + rebootCount + ',' + (motionDataID++) + ',' + (Math.round(IMUClass.floatp_value(yGyroAxis))) + ',' + currentTime.getTime() + '\n';
    if (gyroscopeDataText.length > 200 )  saveGyroscopeData();
}


function saveGyroscopeData(){

    sdCard.appendFile(moduleDataPath + '/' + dataFileNamePrefix + ".csv", gyroscopeDataText, function (err) {
        if(err){
            console.log("ERROR: impossible to save gyroscope data");
        }
        gyroscopeDataText = "";
    });

}


var initWebService = function () {
    app = express();
    app.set('port', (process.env.MONITORING_PORT || 3001));
    app.get('/', function (req, res) {
        //winston.info("Monitoring ROOT");
        res.send('Monitoring');
    });
    app.get('/status', function (req, res) {
        appState = "disabled";
        //winston.info("Monitoring STATUS for " + req.query.device);
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', 'Content-Type');


        var sensorsOverallStatus = "OK";
        var errorStatus = "";

        switch (req.query.device) {
            case "touch" :
                if (!touchSensorWorks()) {
                    errorStatus = "Touch sensor damaged";
                    sensorsOverallStatus = "FAIL";
                }
                break;

            case "motion" :

                if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_WHO_AM_I_G) === 255) {
                    errorStatus += " Gyroscope unreachable. "; // if chip failed return false all the time
                    sensorsOverallStatus += " Gyroscope FAIL ";
                }
                if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_WHO_AM_I_XM) === 255) {
                    errorStatus += " Accelerometer unreachable. "; // if chip failed return false all the time
                    sensorsOverallStatus += " Accelerometer FAIL ";
                }
                break;
        }


        appState = "active";
        //winston.info("STATUS for device " + req.query.device + "\n" + sensorsOverallStatus + "\n" + errorStatus);
        res.send({
            "status": sensorsOverallStatus,
            "error": errorStatus
        });
    });
    app.listen(app.get('port'), function () {
        //winston.info('Monitoring listening on port ' + app.get('port'));
    });
}

serialPort.on("open", function () {
    serialPort.write("\n\r-----------------------------------------------------------\n\r---------------- Starting monitoring app v" + appVersion + " ----------------\n\r", function (err, results) { //Write data
        setupMonitoring();
    });
});

serialPort.on("error", function () {
    console.log("--SERIAL PORT ENCOUNTERED AN ERROR--");
});

serialPort.on("close", function () {
    console.log("...serial port closed");
});




var startCamera = function () {
    appState = "busy";
    setTimeout(powerUsbPortOn, 250);
    setTimeout(recordMovie, 3250);

}

var recordMovie = function () {

    //console.log("Recording a movie... ");
    exec(scriptsPath + "/capture.sh " + dataFileNamePrefix + " " + videoDuration, {timeout: 60000}, function (error, stdout, stderr) {


        if (!error) {
            //console.log("...Video Done");
        } else {
            console.log(" ERROR: Camera could not record videos: " + stderr + "\n" + stdout + "\n" + error);
        }


        powerUsbPortOff();

        var oldDataFileNamePrefix = dataFileNamePrefix;


        //console.log("about to archive...");

        exec(scriptsPath + "/archive.sh " + oldDataFileNamePrefix, {timeout: 60000}, function (error, stdout, stderr) {

            if (!error) {
                //console.log("... archive completed: " );
            }
            else {
                console.log("ERRO : Archiver failed to archive data: " + stderr + "\n" + stdout + "\n" + error);
            }
            justFinishedRecordingMovie = true;

        });


    });

};

var powerUsbPortOn = function () {
    powerBoost.write(1);
    //console.log("... power boosted to 5v");
};

var powerUsbPortOff = function () {
    powerBoost.write(0);
    //console.log("... Back to 3.3 v");
};

function checkHorizontalPosition(){

    gyroAccelCompass.updateAccelerometer();
    gyroAccelCompass.getAccelerometer(xAcceleroValue , yAcceleroValue , zAcceleroValue); // for horizontal detection
    var zAxis = IMUClass.floatp_value(zAcceleroValue);

    if ((zAxis > 0.98) && (zAxis < 2.0) /*&& ( IMUClass.floatp_value(xAcceleroValue ) < 1) && ( IMUClass.floatp_value(yAcceleroValue ) < 1)*/ ) {
        durationInHorizontalPosition++;
        logger("module is horizontal " + durationInHorizontalPosition + " time");
        
        logger("process.env.ROTATION_SPEED= " + process.env.ROTATION_SPEED) ;
        logger("process.env.ROTATION_DURATION= " + process.env.ROTATION_DURATION) ;
        logger("rotationalSpeed= " + rotationalSpeed) ;
        logger("rotationDuration= " + rotationDuration) ;
        
        if (durationInHorizontalPosition === 15) {
            durationInHorizontalPosition = 0 ;
            startAccessPoint();
            accesspointTimeoutReboot();
        }
    } else {
        if ((zAxis < 0.98) && (durationInHorizontalPosition > 0 )) durationInHorizontalPosition--;
    }
    horizontalPositionCheckCountdown =  0.5 * (1000/systemRefreshFrequency);
}

function checkSoapTouches(currentTime) {

    if (soapHasBeenTouched()) {
        //console.log('+');
        soapStatusText += templateDataLogTouch + rebootCount + ',' + (touchDataID++) + ',' + currentTime.getTime() + '\n' ;
        if (soapStatusText.length > 1024) saveSoapTouches(soapStatusText);
    }
    else if (soapStatusText.length >0) timeWithUnsavedTouch++;

    if (timeWithUnsavedTouch > 20) saveSoapTouches(soapStatusText);
}


function saveSoapTouches(touchesToSave){
    soapStatusText = "";
    timeWithUnsavedTouch = 0;
    sdCard.appendFile(moduleDataPath + '/' + dataFileNamePrefix + ".txt",touchesToSave, function(error){
        if (error){
            console.log("ERROR: cannot record touches");
        }
        //else console.log("touches recorded");
    });
}


function showAppState(currentTime){
    console.log("state: " + appState + ' ' + currentTime.getHours() + ':' + currentTime.getMinutes() + ':' + currentTime.getSeconds());
    serialPort.write("state: " + appState + ' ' + currentTime.getHours() + ':' + currentTime.getMinutes() + ':' + currentTime.getSeconds() + "\n\r", function (err, results) {
    });
    serialPort.drain();
    appStateCountdown = 15 *  (1000/systemRefreshFrequency);
}



function checkIfNeedsToSleep(currentTime) {
    var twoMinutes = 2 * 60 * 1000;
    if (currentTime.getTime() > (lastSleep.getTime() + twoMinutes )) {
        goToSleep();
    }
    else console.log("not time to go to sleep yet");
    sleepModeCheckCountdown = 60 * (1000/systemRefreshFrequency);
}

function goToSleep() {
    lastSleep = new Date();
    appState = "sleep";
    //console.log("Preparing to sleep... ");

    exec(scriptsPath + "/sleep.sh ", {timeout: 60000}, function (error) {
        if (error) {
            console.log("---- WE CANNOT SLEEP -----\n" + error );
        }
        console.log("waking up from sleep");
        lastSleep = new Date();
        appState = "active";
        logger("... Awake");
    });

}


//------- GATHERING DATA FROM SENSORS AND TRIGGERS VIDEO --------------
function checkGyroscope() {


  /*  gyroAccelCompass.updateGyroscope();

    var x = new IMUClass.new_floatp();
    var y = new IMUClass.new_floatp();
    var z = new IMUClass.new_floatp();

    gyroAccelCompass.getGyroscope(x, y, z);
    

    var gyroXAxis = Math.round(IMUClass.floatp_value(x));
    var gyroYAxis = Math.round(IMUClass.floatp_value(y));
    var gyroZAxis = Math.round(IMUClass.floatp_value(z));


    // if (!(gyroXAxis >  gyroYAxis ) && !( gyroZAxis >  gyroYAxis )){
    console.log("Gyroscope:     GX: " + gyroXAxis + " AY: " + gyroYAxis + " AZ: " + gyroZAxis);
*/

    if (!alreadyRecordingMovie) {
        alreadyRecordingMovie = true;
        startCamera();
        /*serialPort.write("Rotation " + "\n\r", function (err, results) {
        });
        serialPort.drain();*/
    }

    //}

    //gyroAccelCompass.getAccelerometer(x, y, z); // for horizontal detection
    //console.log("Accelerometer: AX: " + IMUClass.floatp_value(x) + " AY: " + IMUClass.floatp_value(y) +  " AZ: " + IMUClass.floatp_value(z));

    //}

}

function startAccessPoint() {
    logger("starting access point");
    appState = "disabled";
    //NOTE: no timeout for exec here as it will leave the app stalled. accesspointTimeoutReboot is used instead
    exec(scriptsPath + "/startAp.sh ", function (error, stdout, stderr) {

        if (error) {
            appState = "active";
            logger("ERROR: could not start access point");
            console.log("ERROR: could not start AP mode. About to reboot " + error + ' --- ' + stderr);
            reboot();

        } else {
            console.log("in AP mode " + stdout);
            appState = "disabled";
        }
    });

}

function accesspointTimeoutReboot() {
    setTimeout(function () {
        console.log("ap timed out");

        exec(scriptsPath + "/stopAp.sh ", function (error, stdout, stderr) {

            if (error) {
                appState = "active";
                console.log("about to reboot since stopping AP didn't work " + error + ' --- ' + stderr);

            } else {
                console.log("... AP mode stopped " + stdout);
                appState = "active";
            }

            setTimeout(reboot, 5000); //reboot no matter what after AP mode stops
        });

    }, delayBeforeAccessPointTimeout);
}

function stopAccessPoint() {

    exec(scriptsPath + "/stopAp.sh ", function (error, stdout, stderr) {

        if (error) {
            console.log("Stopping AP didn't work:\n " + error + '\n' + stderr + "\n" + stdout);

        } else {
            console.log("... AP mode OFF: " + stdout);
        }
    });

}


//---------------------- IRQ CALLBACK --------------------------

function irqTouchCallback() {
}

function gyroInterruptCallBack() {
console.log("-ISR GYRO");
}

function horizontalPositionCallBack() {
    console.log("-ISR horizontal");
}

function moduleTransportationCallBack() {

    console.log("-ISR transportation");
}
//----------------- UTILITY FUNCTIONS --------------------------

function soapHasBeenTouched() {

    if (soapSensorIsDamaged) return false;
    touchSensor.readButtons();
    var isTouched = touchSensor.m_buttonStates & 1;

    return (isTouched);
}

function setupGyroscope() {

    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_CFG_G,  0x08); // enable interrupt only on Y axis (not Latching)
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG1_G, 0x0A);// Y axis enabled only
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG2_G, 0x00);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG3_G, 0x80);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG5_G, 0x00);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_TSH_YH_G, rotationalSpeed);//set threshold for high rotation speed per AXIS, TSH_YH_G is for Y axis only!
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_DURATION_G, (rotationDuration | 0x80)); //set minimum rotation duration to trigger interrupt (based on frequency)
    

    //showGyrodebugInfo();

    /*gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_CFG_G,  0x48 ); //0x60 is latched interrupt on Y axis

     gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG1_G, 0x0F );     //set Frequency of Gyro sensing (ODR) and axis enabled (x,y,z)
     //gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_DURATION_G, 0x40 ); //set minimum rotation duration to trigger interrupt (based on frequency)
     gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_TSH_ZH_G, 0x01 );   //set threshold for positive rotation speed

     gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG2_G, 0x00 ); // normal mode for filtering data
     gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG3_G, 0x88 ); // interrupt enabled, active high, DRDY enabled
     //gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG5_G, 0x00 ); // all default values
     */
}

function setupAccelerometer() {

    // SETUP GEN 1 FOR Z AXIS HORIZONTAL DETECTION
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_REG, 0x20); //generation on Z high event
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG0_XM, 0x00); //default value
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG1_XM, 0x67); //0x64); //set Frequency of accelero sensing (ODR is 100 Hz) and axis enabled (z)

    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG2_XM, 0x00); // Set accelero scale to 2g
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG3_XM, 0x20); //enable pinXM for acclero interrupt
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG5_XM, 0x0); // nothing latch //GEN 1

    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_DURATION, 0x2F); // set minimum acceleration duration to trigger interrupt
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_THS, 0x3E); // set threshold for slightly below 1G value to trigger interrupt (based on 2G scale in accelero)


    //------ Setup interrypt 2 for container transport detection
    //gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_XM , IMUClass.LSM9DS0.REG_INT_GEN_2_REG,0x8A); //enable X,Y high acceleration (both needed high for interrupt to happen)
    //gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_XM , IMUClass.LSM9DS0.REG_INT_GEN_2_THS,0x64); //100 out of 127 possible on 2G , 100 ~ high 1.5G
    //gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_XM , IMUClass.LSM9DS0.REG_INT_GEN_2_DURATION,0x20); //32 out of 127 possible, 32 = 340 ms


}

function showGyrodebugInfo() {

    /*winston.info("Gyro CFG : 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_CFG_G).toString(16));
    winston.info("Gyro REG1: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG1_G).toString(16));
    winston.info("Gyro REG2: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG2_G).toString(16));
    winston.info("Gyro REG3: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG3_G).toString(16));
    winston.info("Gyro REG4: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG4_G).toString(16));
    winston.info("Gyro REG5: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG5_G).toString(16));
    winston.info("Gyro status" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_STATUS_REG_G).toString(16));
    winston.info("Gyro FIFO . 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_FIFO_CTRL_REG_G).toString(16));
    winston.info("Gyro interrupt source: " + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_SRC_G).toString(16));
    */
}

function logger(msg) {
    console.log(msg + "\n");
    serialPort.write(msg + "\n\r", function (err, results) {
    });
    serialPort.drain();
    //winston.info(msg);
}

// exit on ^C
process.on('SIGINT', function () {
    //winston.info("Exiting.");
    process.exit(0);
});


function showHardwareStateOnButton() {

    pushButtonLight.dir(mraa.DIR_OUT);

    var blinkingOn = setInterval(function () {
        pushButtonLight.write(1);
    }, 200);


    var blinkingOff = setInterval(function () {
        pushButtonLight.write(0);
    }, 250);

    if (!(soapSensorIsDamaged || IMUSensorIsDamaged)) {
        clearInterval(blinkingOn);
        clearInterval(blinkingOff);
        pushButtonLight.write(1);
    }

    console.log("Push Button about turns ON");
    setTimeout(function () {
        pushButtonLight.write(0);
        console.log("Push Button IS OFF");

    }, 8000);


}

//-----------------------------------------------------------------------------------------------------------
function setupMonitoring() {
    initWebService();
    logger("App mode: " + appMode);

//------------------ initialize power booster to OFF
    powerBoost = new mraa.Gpio(voltageBoostPin);
    powerBoost.dir(mraa.DIR_OUT);
    powerBoost.write(0);

    touchSensor = new touchSensorDriver.MPR121(touchSensorDriver.MPR121_I2C_BUS, touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);

    if (touchSensorWorks()) {
        logger("TOUCH SENSOR OK");
        initTouchSensor();


        //NOTE: this below is turned Off since we are not waking up from touch, only when rotation is right
        //do we allow touch to work

        //Pin setup for touch sensor interrupt
        // var touchInterruptPin = new mraa.Gpio(capacitiveSensorInterruptPin);
        //touchInterruptPin.dir(mraa.DIR_IN);


        // setTimeout(function () {
        // touchInterruptPin.isr(mraa.EDGE_BOTH, irqTouchCallback);
        //  }, 1000);

    }
    else {
        logger(" !!!!!!!!!!!!!!!!!! NO TOUCH SENSOR !!!!!!!!!!!!!!!!");
        logError.appendFileSync(ErrorLogFileName, "Touch sensor not responding, might be damaged. On " + new Date().getTime() + '\n', encoding = 'utf8',
            function (err) {
                //winston.error("Error log failing , critical error");
            });
    }


    gyroAccelCompass = new IMUClass.LSM9DS0();

    if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_WHO_AM_I_G) != 255) {
        logger("MOTION SENSOR OK");
        gyroAccelCompass.init();                          // Initialize the device with default values
        setupGyroscope();
        setupAccelerometer();


        gyrocsopeInterrupt = new mraa.Gpio(GyroscopeInterruptPin);
        gyrocsopeInterrupt.dir(mraa.DIR_IN);

        horizontalPositionInterrupt = new mraa.Gpio(horizontalPositionInterruptPin);
        horizontalPositionInterrupt.dir(mraa.DIR_IN);


        var moduleTransportationInterrupt = new mraa.Gpio(moduleIsBeingTransportedInterruptPin);
        moduleTransportationInterrupt.dir(mraa.DIR_IN);


        gyrocsopeInterrupt.isr(mraa.EDGE_BOTH, gyroInterruptCallBack);
        horizontalPositionInterrupt.isr(mraa.EDGE_BOTH, horizontalPositionCallBack);
        moduleTransportationInterrupt.isr(mraa.EDGE_BOTH, moduleTransportationCallBack);

    }
    else {
        logger(" !!!!!!!!!!!!!!!!!! NO MOTION SENSOR !!!!!!!!!!!!!!!!");
        IMUSensorIsDamaged = true;
        logError.appendFileSync(ErrorLogFileName, "Motion sensor not responding, might be damaged. On " + new Date().getTime() + '\n', encoding = 'utf8',
            function (err) {
                //winston.error("Error log failing , critical error");
            });
    }

    showHardwareStateOnButton();

    setTimeout(function(){
        appState = "active";
    }, delayBeforeActivatingAllSensors );

}


function touchSensorWorks() {
    var touchI2c = new mraa.I2c(touchSensorDriver.MPR121_I2C_BUS);
    touchI2c.address(touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);
    var touchSensorI2CWorks = 0;
    try {
        touchSensorI2CWorks = touchI2c.readReg(0x5D);
    }
    catch (err) {
        touchSensorI2CWorks = 0;
        soapSensorIsDamaged = true;
    }
    return touchSensorI2CWorks;
}

function initTouchSensor() {
    var touchI2c = new mraa.I2c(touchSensorDriver.MPR121_I2C_BUS);
    touchI2c.address(touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);

    touchI2c.writeReg(0x5e, 0x0); // set all touch pins to 0

    touchI2c.writeReg(0x2b, 0x01); // set baseline data
    touchI2c.writeReg(0x2c, 0x01); // set baseline data
    touchI2c.writeReg(0x2d, 0x0); // set baseline data
    touchI2c.writeReg(0x2e, 0x0); // set baseline data

    touchI2c.writeReg(0x2f, 0x01); // set filter data lower than baseline
    touchI2c.writeReg(0x30, 0x01); // set filter data lower than baseline
    touchI2c.writeReg(0x31, 0xff); // set filter data lower than baseline
    touchI2c.writeReg(0x32, 0x02); // set filter data lower than baseline


    touchI2c.writeReg(0x41, 0x1f); // ONLY ONE ACTIVE touch threshold
    touchI2c.writeReg(0x42, 0x1a); // ONLY ONE ACTIVE release threshold


    touchI2c.writeReg(0x43, 0xff); //touch threshold
    touchI2c.writeReg(0x44, 0x0a); //touch threshold

    touchI2c.writeReg(0x45, 0xff); //touch threshold
    touchI2c.writeReg(0x46, 0x0a); //touch threshold

    touchI2c.writeReg(0x47, 0xff); //touch threshold
    touchI2c.writeReg(0x48, 0x0a); //touch threshold

    touchI2c.writeReg(0x49, 0xff); //touch threshold
    touchI2c.writeReg(0x4A, 0x0a); //touch threshold

    touchI2c.writeReg(0x4B, 0xff); //touch threshold
    touchI2c.writeReg(0x4C, 0x0a); //touch threshold

    touchI2c.writeReg(0x4D, 0xff); //touch threshold
    touchI2c.writeReg(0x4E, 0x0a); //touch threshold

    touchI2c.writeReg(0x4F, 0xff); //touch threshold
    touchI2c.writeReg(0x50, 0x0a); //touch threshold

    touchI2c.writeReg(0x51, 0xff); //touch threshold
    touchI2c.writeReg(0x52, 0x0a); //touch threshold

    touchI2c.writeReg(0x53, 0xff); //touch threshold
    touchI2c.writeReg(0x54, 0x0a); //touch threshold

    touchI2c.writeReg(0x55, 0xff); //touch threshold
    touchI2c.writeReg(0x56, 0x0a); //touch threshold

    touchI2c.writeReg(0x57, 0xff); //touch threshold
    touchI2c.writeReg(0x58, 0x0a); //touch threshold

    touchI2c.writeReg(0x5D, 0x24); //filter configuration

    touchI2c.writeReg(0x7b, 0x0B); //Autoconfiguration ON (default values)

    touchI2c.writeReg(0x7d, 0xC9); //Autoconfiguration registers set for 3.3v
    touchI2c.writeReg(0x7e, 0x83); //Autoconfiguration registers set for 3.3v
    touchI2c.writeReg(0x7f, 0xB5); //Autoconfiguration registers set for 3.3v

    touchI2c.writeReg(0x5e, 0x01); //this step is always LAST, only pin 0 is O
    
    touchI2c.frequency(mraa.I2C_FAST);

}

function generateID() {
    var randomString = Math.random().toString(36).substring(10);
    return rebootCount + '_' + currentDate() + '_' + randomString;
}

function currentDate() {
    var d = new Date(),
        month = '' + (d.getMonth() + 1),
        day = '' + d.getDate(),
        year = d.getFullYear(),
        hour = '' + d.getHours(),
        min = '' + d.getMinutes(),
        sec = '' + d.getSeconds();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    if (hour.length < 2) hour = '0' + hour;
    if (min.length < 2) min = '0' + min;
    if (sec.length < 2) sec = '0' + sec;
    return [year, month, day].join('_') + '-' + [hour, min, sec].join('_');
}

function rebootIfNeeded(currentTime) {
    var eightHours = 8 * 60 * 60 * 1000;
    if (appState !== "disabled" && currentTime.getTime() > (startDate.getTime() + eightHours)) {
        appState = "disabled";
        reboot();
    }
}

function reboot() {
    exec("reboot now", function (out, err, err2) {
        console.log("rebooting... " + out + err + err2);
    });
}


// ------------------------------------------------------------




var justFinishedRecordingMovie = false;

// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
setInterval(function () {


    currentTime = new Date();

    if (appState === "active") {
        rebootIfNeeded(currentTime);
        if (--sleepModeCheckCountdown === 0) checkIfNeedsToSleep(currentTime);
        if (appState === "sleep") return;
    }


    if (alreadyRecordingMovie) getGyroscopeData(currentTime);
    //if ( --appStateCountdown === 0) showAppState(currentTime);
    checkSoapTouches(currentTime);

    if ( appState === "active") {
        if (--horizontalPositionCheckCountdown < 0) checkHorizontalPosition();

        if (gyrocsopeInterrupt.read() === 1) moduleisRotating = true;
        if (moduleisRotating ) checkGyroscope();
    }

    if(justFinishedRecordingMovie){
        console.log("done video recording");
        dataFileNamePrefix = generateID();
        alreadyRecordingMovie = false;
        moduleisRotating = false ;
        appState = "active";
        justFinishedRecordingMovie = false;
        goToSleep();
    }


}, systemRefreshFrequency);
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------