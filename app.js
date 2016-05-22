var SegfaultHandler = require('segfault-handler');
SegfaultHandler.registerHandler("crash.log");

// ONLY INITIALIZATION BEFORE OTHER ELEMENTS
var SerialPort = require("serialport").SerialPort;
var serialPath = "/dev/ttyMFD2";
var serialPort = new SerialPort(serialPath, {
    baudrate: 115200
});

var appVersion = 22;
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
var dataFileNamePrefix = generateID();

//var express = require('express');
var sdCard = require('fs');




var touchSensorDriver = require('jsupm_mpr121'); // GLOBAL variable
var IMUClass = require('jsupm_lsm9ds0');  // Instantiate an LSM9DS0 using default parameters (bus 1, gyro addr 6b, xm addr 1d)
var exec = require('child_process').exec;

var alreadyRecordingMovie = false;
var moduleisRotation = false;
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

appMode = "development"; //fixme change back to commented

videoDuration = (appMode === "production") ? "40" : "5";
delayBeforeActivatingAllSensors = (appMode === "production") ? (1 * 5 * 1000) : 1000;
delayBeforeAccessPointTimeout = (appMode === "production") ? (20 * 60 * 1000) : (2 * 60 * 1000);

var moduleIsHorizontal = 0;
//winston.info("new file prefix: " + dataFileNamePrefix);

var gyroZaxisTransient = 0x20; //0o00100000 ;/
var gyroZaxisLatchedHigh = 0x60; //01100000 ;
var gyroZaxisLatchedBoth = 0x70; //01100000 ;
var gyroInterruptActive = 0x80; // 10000000 ;
var weAreRotating = 0x60; //0x40 is interrupt triggered
var touchThresholdAddress = 0x41; // address to set the touch threshold,
var touchThreshold = 255; // lowest sensitivity

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
var systemRefreshFrequency = 100; //ms

var appStateCountdown = 15 *  (1000/systemRefreshFrequency);
var horizontalPositionCheckCountdown = 0.5 * (1000/systemRefreshFrequency);
var sleepModeCheckCountdown = 60 * (1000/systemRefreshFrequency);

var xAcceleroValue = new IMUClass.new_floatp();
var yAcceleroValue = new IMUClass.new_floatp();
var zAcceleroValue = new IMUClass.new_floatp();

// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
setInterval(function () {

    rebootIfNeeded();

    if ( --appStateCountdown === 0) showAppState();
    if ( appState != "active") return;
    if ( --horizontalPositionCheckCountdown === 0 ) checkHorizontalPosition();

    checkSoapTouches();
    checkGyroscope();

    if (--sleepModeCheckCountdown === 0 ) checkIfNeedsToSleep();

}, systemRefreshFrequency);
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------



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
    });
});

serialPort.on("error", function () {
    console.log("--SERIAL PORT ENCOUNTERED AN ERROR--");

});

serialPort.on("close", function () {
    console.log("...serial port closed");
});

var recordMovie = function () {

    logger("About to record a movie... ");
    exec(scriptsPath + "/capture.sh " + dataFileNamePrefix + " " + videoDuration, {timeout: 60000}, function (error, stdout, stderr) {

        if (!error) {
            logger("image captured successfully: " + stdout);
        } else {
            logger(" ERROR: Camera could not record videos: " + stderr + "\n" + stdout + "\n" + error);
        }

        powerUsbPortOff();
        var oldDataFileNamePrefix = dataFileNamePrefix;
        dataFileNamePrefix = generateID();

        logger("about to archive...");

        exec(scriptsPath + "/archive.sh " + oldDataFileNamePrefix, {timeout: 60000}, function (error, stdout, stderr) {
            if (!error) {
                logger("... archive completed: " + stdout);
                goToSleep();
            }
            else {
                logger("ERRO : Archiver failed to archive data: " + stderr + "\n" + stdout + "\n" + error);
            }


        });

        alreadyRecordingMovie = false;

        appState = "active";
    });
};

var startCamera = function () {
    if (appState === "disabled") return;
    alreadyRecordingMovie = true;
    setTimeout(powerUsbPortOn, 250);
    appState = "busy";
    setTimeout(recordMovie, 3250);
}

var powerUsbPortOn = function () {
    powerBoost.write(1);
    logger("... power boosted to 5v");
};

var powerUsbPortOff = function () {
    logger("About to go back to 3.3 v... ");
    powerBoost.write(0);
    logger("... Back to 3.3 v");
};

function checkHorizontalPosition(){

    gyroAccelCompass.updateAccelerometer();
    gyroAccelCompass.getAccelerometer(xAcceleroValue , yAcceleroValue , zAcceleroValue); // for horizontal detection
    var zAxis = IMUClass.floatp_value(zAcceleroValue);

    if ((zAxis > 0.985) && (zAxis < 2.0) && ( IMUClass.floatp_value(xAcceleroValue ) < 1) && ( IMUClass.floatp_value(yAcceleroValue ) < 1)) {
        durationInHorizontalPosition++;
        logger("module is horizontal");
        if (durationInHorizontalPosition === 15) {
            startAccessPoint();
            accesspointTimeoutReboot();
        }
    } else {
        if ((zAxis < 0.98) && (durationInHorizontalPosition > 0 )) durationInHorizontalPosition--;
    }
    horizontalPositionCheckCountdown =  0.5 * (1000/systemRefreshFrequency);
}

function checkSoapTouches() {
    if (soapHasBeenTouched()) {
        soapStatusText += templateDataLogTouch + rebootCount + ',' + (touchDataID++) + ',' + Date.now() + '\n' ;
        if (soapStatusText.length > 1024) saveSoapTouches(soapStatusText);
    }
    else if (soapStatusText.length >0) timeWithUnsavedTouch++;

    if (timeWithUnsavedTouch > 20) saveSoapTouches(soapStatusText);
}

function showAppState(){
    currentTime = new Date();
    logger("state: " + appState + ' ' + currentTime.getHours() + ':' + currentTime.getMinutes() + ':' + currentTime.getSeconds());
    serialPort.write("state: " + appState + ' ' + currentTime.getHours() + ':' + currentTime.getMinutes() + ':' + currentTime.getSeconds() + "\n\r", function (err, results) {
    });
    serialPort.drain();
    appStateCountdown = 15 *  (1000/systemRefreshFrequency);
}

function saveSoapTouches(touchesToSave){
    soapStatusText = "";
    timeWithUnsavedTouch = 0;
    sdCard.appendFile(moduleDataPath + '/' + dataFileNamePrefix + ".txt",touchesToSave, function(){
        logger("soap touched recorded at " +new Date().getSeconds());
    });
}

function checkIfNeedsToSleep() {
    var thirtyMinutes = 1 * 30 * 1000; //fixme should be 30 minutes
    if (new Date().getTime() > (lastSleep.getTime() + thirtyMinutes )) {
        goToSleep();
    }
    else logger("not time to go to sleep yet");
    sleepModeCheckCountdown = 60 * (1000/systemRefreshFrequency);
}


//------- GATHERING DATA FROM SENSORS AND TRIGGERS VIDEO --------------
function checkGyroscope() {


    // GYROSCOPIC INFORMATION --------------------------
    if (!moduleisRotation) return;

    gyroAccelCompass.updateGyroscope();

    var x = new IMUClass.new_floatp();
    var y = new IMUClass.new_floatp();
    var z = new IMUClass.new_floatp();

    gyroAccelCompass.getGyroscope(x, y, z);

    var gyroXAxis = Math.round(IMUClass.floatp_value(x));
    var gyroYAxis = Math.round(IMUClass.floatp_value(y));
    var gyroZAxis = Math.round(IMUClass.floatp_value(z));


    // if (!(gyroXAxis >  gyroYAxis ) && !( gyroZAxis >  gyroYAxis )){
    logger("Gyroscope:     GX: " + gyroXAxis + " AY: " + gyroYAxis + " AZ: " + gyroZAxis);

    if (!alreadyRecordingMovie) {
        startCamera();
        serialPort.write("Rotation " + "\n\r", function (err, results) {
        });
        serialPort.drain();
    }

    //}

    //gyroAccelCompass.getAccelerometer(x, y, z); // for horizontal detection
    //logger("Accelerometer: AX: " + IMUClass.floatp_value(x) + " AY: " + IMUClass.floatp_value(y) +  " AZ: " + IMUClass.floatp_value(z));

    //}

    if (alreadyRecordingMovie) {
        logger("!!!!!!!!!!!!!!!!!!!!!!!!!!!!! alreadyRecordingMovie = TRUE ");
         sdCard.appendFile(moduleDataPath + '/' + dataFileNamePrefix + ".csv", templateDataLogMotion + rebootCount + ',' + (motionDataID++) + ',' + gyroYAxis + ',' + Date.now() + '\n', function (err) {
            if (err) {
                //winston.error("Motion failed to record on sdcard");
                logError.appendFileSync(ErrorLogFileName, "Motion failed to record on sdcard on " + new Date().getTime() + '\n', encoding = 'utf8',
                    function (err) {
                        //winston.error("all data access failed, critical error");
                    });
            }
         });
    }

    moduleisRotation = false;

}



function startAccessPoint() {

    //NOTE: no timeout for exec here as it will leave the app stalled. accesspointTimeoutReboot is used instead
    exec(scriptsPath + "/startAp.sh ", function (error, stdout, stderr) {

        if (error) {
            appState = "active";
            logger("ERROR: could not start AP mode. About to reboot " + error + ' --- ' + stderr);
            reboot();

        } else {
            logger("in AP mode " + stdout);
            appState = "disabled";
        }
    });

}




function accesspointTimeoutReboot() {
    setTimeout(function () {
        logger("ap timed out");

        exec(scriptsPath + "/stopAp.sh ", function (error, stdout, stderr) {

            if (error) {
                appState = "active";
                logger("about to reboot since stopping AP didn't work " + error + ' --- ' + stderr);

            } else {
                logger("... AP mode stopped " + stdout);
                appState = "active";
            }

            setTimeout(reboot, 5000); //reboot no matter what after AP mode stops
        });

    }, delayBeforeAccessPointTimeout);
}

function stopAccessPoint() {

    exec(scriptsPath + "/stopAp.sh ", function (error, stdout, stderr) {

        if (error) {
            logger("Stopping AP didn't work:\n " + error + '\n' + stderr + "\n" + stdout);

        } else {
            logger("... AP mode OFF: " + stdout);
        }
    });

}


//---------------------- IRQ CALLBACK --------------------------

function irqTouchCallback() {
    lastSleep = new Date();
}

function gyroInterruptCallBack() {
    lastSleep = new Date();
    if ( appState === "active"  )  moduleisRotation = true;
    //logger("ISR Rotation ");
}

function horizontalPositionCallBack() {
    lastSleep = new Date();
    logger("-ISR horizontal");
}

function moduleTransportationCallBack() {
    lastSleep = new Date();
    logger("-ISR transportation");
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
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_TSH_YH_G, 0x10);//0x20); // 0x25 ); //set threshold for high rotation speed per AXIS, TSH_YH_G is for Y axis only!
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_DURATION_G, 0x87); //set minimum rotation duration to trigger interrupt (based on frequency)


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


function thereIsARotation() {
    if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_WHO_AM_I_G) === 255) return false; // if chip failed return false all the time
    if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_SRC_G) >= weAreRotating) return true;
    return false;

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

// ---- UTILITY FUNCTIONS ----------
function isEmpty(obj) {
    for (var prop in obj) {
        if (obj.hasOwnProperty(prop))
            return false;
    }

    return true && JSON.stringify(obj) === JSON.stringify({});
}

function logger(msg) {
    console.log(msg + "\n");
    /*serialPort.write(msg + "\n\r", function (err, results) {
    });
    serialPort.drain();*/


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

    logger("Push Button about turns ON");
    setTimeout(function () {
        pushButtonLight.write(0);
        logger("Push Button IS OFF");

    }, 8000);


}

//-----------------------------------------------------------------------------------------------------------
function setupMonitoring() {


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

function rebootIfNeeded() {
    var eightHours = 8 * 60 * 60 * 1000;
    if (appState !== "disabled" && new Date().getTime() > (startDate.getTime() + eightHours)) {
        logger("--------------- Reboot needed ---------------");
        appState = "disabled";
        reboot();
    }
}

function reboot() {
    exec("reboot now", function (out, err, err2) {
        logger("rebooting... " + out + err + err2);
    });
}

function forceReboot() {
    exec("reboot -f", function (out, err, err2) {
        logger("rebooting... " + out + err + err2);
    });
}

function goToSleep() {
    logger("Preparing to sleep... ");
    lastSleep = new Date();
    exec(scriptsPath + "/sleep.sh ", {timeout: 60000}, function (error, stdout, stderr) {
        if (error) {
            logger("---- WE CANNOT SLEEP -----\n" + error + "\n" + stdout + "\n" + stderr);
        }
    });
}


// ------------------------------------------------------------

var pushButtonLightStyle = 0;

//initWebService();
logger("App mode: " + appMode);

//------------------ initialize power booster to OFF
powerBoost = new mraa.Gpio(voltageBoostPin);
powerBoost.dir(mraa.DIR_OUT);
powerBoost.write(1);

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
    logger("init gyro int ISR");

    horizontalPositionInterrupt = new mraa.Gpio(horizontalPositionInterruptPin);
    horizontalPositionInterrupt.dir(mraa.DIR_IN);
    logger("init horizontal int ISR");

    var moduleTransportationInterrupt = new mraa.Gpio(moduleIsBeingTransportedInterruptPin);
    moduleTransportationInterrupt.dir(mraa.DIR_IN);
    logger("init IMU int ISR");


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

