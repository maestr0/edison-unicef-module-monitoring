
var appVersion = 17;
var startDate = new Date();

var numberOfTouchOnSoap = 0;
var mraa = require('mraa');
var appState = "initialize";



var express = require('express');
var logFile = require('fs');
var logError = require('fs');
var fs = require('fs');


var touchSensorDriver = require('jsupm_mpr121');
var IMUClass = require('jsupm_lsm9ds0');  // Instantiate an LSM9DS0 using default parameters (bus 1, gyro addr 6b, xm addr 1d)
var exec = require('child_process').exec;

var alreadyRecordingMovie = false;
var moduleisRotation = false ;
var durationInHorizontalPosition = 0 ;

var capacitiveSensorInterruptPin = 8;
var voltageBoostPin = 9;
var moduleIsBeingTransportedInterruptPin = 10;
var horizontalPositionInterruptPin = 11;
var GyroscopeInterruptPin = 12;
var pushButtonLightPin = 13;

moduleDataPath = process.env.MODULE_DATA_DIR || "/media/sdcard/data";
scriptsPath = process.env.SCRIPTS || "/home/root/scripts";
serialNumber = process.env.SERIAL_NUMBER || "mocked-serial-no";
rebootCount = process.env.REBOOT_COUNT || "HARDCODED_VALUE";

// FIXME: disable dev mode
// appMode = process.env.NODE_ENV || "development";
appMode = "development";

videoDuration = (appMode === "production") ? "40" : "11";
delayBeforeActivatingAllSensors = (appMode === "production") ? (1000 * 60 * 7) : 1000;
delayBeforeAccessPointTimeout = (appMode === "production") ? (20 * 60 * 1000) : (2 * 60 * 1000);

var moduleIsHorizontal = 0;
var dataFileNamePrefix = generateID();

var gyroZaxisTransient = 0x20; //0o00100000 ;/
var gyroZaxisLatchedHigh = 0x60; //01100000 ;
var gyroZaxisLatchedBoth = 0x70; //01100000 ;
var gyroInterruptActive = 0x80; // 10000000 ;
var weAreRotating = 0x60; //0x40 is interrupt triggered
var touchThresholdAddress = 0x41; // address to set the touch threshold,
var touchThreshold = 255; // lowest sensitivity

var touchDataID = 0;

var ErrorLogFileName = moduleDataPath + "/error.log";
var templateDataLogTouch = serialNumber + ",C,";

var i2c;

var powerBoost;
var touchSensor;
var soapSensorIsDamaged = false;
var IMUSensorIsDamaged = false;
var gyroAccelCompass; //= new IMUClass.LSM9DS0()  ;
var app;






// ONLY INITIALIZATION BEFORE OTHER ELEMENTS
var SerialPort = require("serialport").SerialPort;
var serialPath = "/dev/ttyMFD2";
var serialPort = new SerialPort(serialPath, {
    baudrate: 115200
});

serialPort.on("open", function () {
    serialPort.write("\n\r-----------------------------------------------------------\n\r---------------- Starting monitoring app v" + appVersion + " ----------------\n\r", function (err, results) { //Write data
    });
    if (appState === "initialize") setupMonitoring();
});

serialPort.on("error", function () {
    console.log("serial port error, closing port... ");
    if (appState === "initialize") setupMonitoring();

});

serialPort.on("close", function () {
    console.log("...serial port closed");
    if (appState === "initialize") setupMonitoring();
});


var initWebService = function (){
    app = express();
    app.set('port', (process.env.MONITORING_PORT || 3001));
    app.get('/', function (req, res) {
        res.send('Monitoring');
    });
    app.get('/status', function (req, res) {
        appState = "disabled";
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', 'Content-Type');


        var sensorsOverallStatus = "OK";
        var errorStatus = "";

        switch (req.query.device) {
            case "motion" :
                if (!touchSensorWorks()) {
                    errorStatus = "Touch sensor damaged";
                    sensorsOverallStatus = "FAIL";
                }
                break;

            case "touch" :

                if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_WHO_AM_I_G) === 255) {
                    errorStatus += "Gyroscope unreachable. "; // if chip failed return false all the time
                    sensorsOverallStatus += "Gyroscope FAIL";
                }
                if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_WHO_AM_I_XM) === 255) {
                    errorStatus += "Accelerometer unreachable. "; // if chip failed return false all the time
                    sensorsOverallStatus += "Accelerometer FAIL";
                }
                break;
        }


        appState = "active";

        res.send({
            "status": sensorsOverallStatus,
            "error": errorStatus
        });
    });
    app.listen(app.get('port'), function () {
        console.log('Monitoring listening on port ' + app.get('port'));
    });
}




var c = 0;
var c2 = 0;
var queue = [];
var processLogQueue = function () {
    console.log("queue processing...");
    var topElement = queue.pop();

    if (topElement) {

        //        logFile.appendFile('/home/root/sleep.txt', topElement + '\n', encoding = 'utf8',
        //            function (err) {
        //                if (err) {
        //                    console.error("shit happened with the file writter");
        //                throw err};
        //
        //                processLogQueue();
        //            });

        processLogQueue();

    } else {
        console.log("log queue empty, sleeping for 1s");

        setTimeout(processLogQueue, 1000);
    }

};
//setTimeout(processLogQueue, 1000);



var recordMovie = function () {


    logger(" ...about to record a movie... ");

    var command = scriptsPath + "/capture.sh " + dataFileNamePrefix + " " + videoDuration;

    exec(command, {timeout: 60000}, function (error, stdout, stderr) {

        if (!error) {
            logger("image captured successfully");
        } else {
            logger(" ERROR: Camera could not record videos" + stderr);
        }

        powerUsbPortOff();
        var oldDataFileNamePrefix = dataFileNamePrefix;
        dataFileNamePrefix = generateID();

        logger("about to archive...");

        exec(scriptsPath + "/archive.sh " + oldDataFileNamePrefix, {timeout: 60000}, function (error, stdout, stderr) {
            if (!error) {
                logger("... archive completed" + stdout);

                exec(scriptsPath + "/sleep.sh ", {timeout: 60000}, function (error, stdout, stderr) {
                    if (error) {
                        logger("---- WE CANNOT SLEEP -----");
                    }
                });

            }
            else {

                logger("ERRO : Archiver failed to archive data" + stderr);
            }


        });

        alreadyRecordingMovie = false;

        /*logFile.appendFile('/home/root/camera.txt', msg + '\n', encoding = 'utf8',
         function (err) {
         if (err) {
         console.error("shit happened with the file writter");
         throw err;
         }
         });
         */
        appState = "active";
    });
};

var startCamera = function (){
    if (appState == "disabled") return;

    powerUsbPortOn();
    alreadyRecordingMovie = true;
    appState = "busy";
    setTimeout(recordMovie, 3000);
}

//---------------------- RUN LOOPS --------------------------
var powerUsbPortOn = function () {
    logger("about to set 1 on POWER BOOST pin");
    powerBoost.write(1);
    logger("... power boosted to 5v");
};

var powerUsbPortOff = function () {
    logger("About to go back to 3.3 v... ");
    powerBoost.write(0);
    logger("... Back to 3.3 v");
};


setInterval(function () {
    logger("state: " + appState );
}, 5000);




//------- WATER CONTAINER IN HORIZONTAL POSITION --------------
setInterval(function () {
    if (appState != "disabled") {

            gyroAccelCompass.update();

            var x = new IMUClass.new_floatp();
            var y = new IMUClass.new_floatp();
            var z = new IMUClass.new_floatp();
            gyroAccelCompass.getAccelerometer(x, y, z); // for horizontal detection

            //logger("counting horizontal : " + durationInHorizontalPosition + " z: " + IMUClass.floatp_value(z));

            if ( (IMUClass.floatp_value(z) > 0.985) && (IMUClass.floatp_value(z)  < 2.0) && ( IMUClass.floatp_value(x) < 1) && ( IMUClass.floatp_value(y) < 1)){

                durationInHorizontalPosition++;


                if (durationInHorizontalPosition === 15) {
                    startAccessPoint();
                    accesspointTimeoutReboot();
                }

            }else {
                if ( (IMUClass.floatp_value(z) < 0.98) && (durationInHorizontalPosition > 0 )) durationInHorizontalPosition--;

            }

    }
}, 500);


// SOAP TOUCH --------------------------
setInterval( function(){
    rebootIfNeeded();

    if (  (soapHasBeenTouched() || numberOfTouchOnSoap >0 ) && appState != "disabled") {
        logger("soap touched");
        logFile.appendFile(moduleDataPath + '/' + dataFileNamePrefix + ".txt", templateDataLogTouch + rebootCount + ',' + (touchDataID++) + ',' + Date.now() + '\n', encoding = 'utf8',
            function (err) {
                if (err) {
                    console.error("Touch failed to record on sdcard");
                    logError.appendFileSync(ErrorLogFileName, "Touch failed to record on sdcard on " + new Date().getTime() + '\n', encoding = 'utf8',
                        function (err) {
                            console.error("all data access failed, critical error");
                        });
                }
            });

        numberOfTouchOnSoap = 0;
    }

}, 100);

//------- GATHERING DATA FROM SENSORS AND TRIGGERS VIDEO --------------
setInterval(function () {


    // GYROSCOPIC INFORMATION --------------------------
    if (!moduleisRotation) return;


    //if ( thereIsARotation()) {
    // logger( gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_XM , IMUClass.LSM9DS0.REG_WHO_AM_I_XM )); // if chip failed return false all the time
    // logger( gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_WHO_AM_I_G )); // if chip failed return false all the time

    //console.log( "Rotation detected");
    gyroAccelCompass.update();

    var x = new IMUClass.new_floatp();
    var y = new IMUClass.new_floatp();
    var z = new IMUClass.new_floatp();
    //test if removing does not alter horizontal detection gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_SRC);

    //gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_2_SRC); // for horizontal

    //logger("Origin int GEN2: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_2_SRC).toString(16) + ". " +
    //  "Origin int GEN1: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_SRC).toString(16));// + ". "+
    //"Origin INTG: 0x"+ gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_SRC_G).toString(16) );

    gyroAccelCompass.getGyroscope(x, y, z);

    var gyroXAxis = Math.round(IMUClass.floatp_value(x)) ;
    var gyroYAxis = Math.round(IMUClass.floatp_value(y)) ;
    var gyroZAxis = Math.round(IMUClass.floatp_value(z)) ;


   // if (!(gyroXAxis >  gyroYAxis ) && !( gyroZAxis >  gyroYAxis )){
        logger("Gyroscope:     GX: " + gyroXAxis + " AY: " + gyroYAxis + " AZ: " + gyroZAxis);

        if (!alreadyRecordingMovie) {
            startCamera();
        }
    //}

    //gyroAccelCompass.getAccelerometer(x, y, z); // for horizontal detection
    //logger("Accelerometer: AX: " + IMUClass.floatp_value(x) + " AY: " + IMUClass.floatp_value(y) +  " AZ: " + IMUClass.floatp_value(z));

    //}
    moduleisRotation = false ;

}, 100);


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

            setTimeout(reboot, 5000) //reboot no matter what after AP mode stops
        });

    }, delayBeforeAccessPointTimeout);
}


function stopAccessPoint(){

    exec(scriptsPath + "/stopAp.sh ", function (error, stdout, stderr) {

        if (error) {
            logger("Stopping AP didn't work " + error + ' --- ' + stderr);

        } else {
            logger("... AP mode OFF" + stdout);
        }
    });

}




//---------------------- IRQ CALLBACK --------------------------

function irqTouchCallback() {

    numberOfTouchOnSoap++;
    //logger("-ISR Touch: " + numberOfTouchOnSoap);

}

function gyroInterruptCallBack() {
    // Leave this callback empty, only for waking up the device
    moduleisRotation = true ;
    logger("Rotation detected by ISR !!!!");

}

function horizontalPositionCallBack() {
    // Leave this callback empty, only for waking up the device
}

function moduleTransportationCallBack() {
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

    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_CFG_G, 0x08); // enable interrupt only on Y axis
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG1_G, 0x0A);// Y axis enabled only
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG2_G, 0x00);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG3_G, 0x80);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG5_G, 0x00);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_TSH_YH_G, 0x20); // 0x25 ); //set threshold for high rotation speed per AXIS, TSH_YH_G is for Y axis only!
    gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_DURATION_G, 0x0A); //set minimum rotation duration to trigger interrupt (based on frequency)


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

    console.log("Gyro CFG : 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_CFG_G).toString(16));
    console.log("Gyro REG1: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG1_G).toString(16));
    console.log("Gyro REG2: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG2_G).toString(16));
    console.log("Gyro REG3: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG3_G).toString(16));
    console.log("Gyro REG4: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG4_G).toString(16));
    console.log("Gyro REG5: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG5_G).toString(16));
    console.log("Gyro status" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_STATUS_REG_G).toString(16));
    console.log("Gyro FIFO . 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_FIFO_CTRL_REG_G).toString(16));
    console.log("Gyro interrupt source: " + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_SRC_G).toString(16));
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
    serialPort.write(msg + "\n\r", function (err, results) {
    });
    console.log(msg);
}

// exit on ^C
process.on('SIGINT', function () {
    sensor = null;
    sensorObj.cleanUp();
    sensorObj = null;
    console.log("Exiting.");
    process.exit(0);
});



function showHardwareStateOnButton(){
    var pushButtonLight = new mraa.Gpio(pushButtonLightPin);
    pushButtonLight.dir(mraa.DIR_OUT);

    var blinkingOn = setInterval( function(){
        pushButtonLight.write(1);
    }, 200);


    var blinkingOff =  setInterval( function(){
        pushButtonLight.write(0);
    }, 250);

    if ( !(soapSensorIsDamaged || IMUSensorIsDamaged) ) {
        clearInterval(blinkingOn);
        clearInterval(blinkingOff);
        pushButtonLight.write(1);
    }


    setTimeout(function () {
        pushButtonLight.write(0);
    }, 8000);


}

//-----------------------------------------------------------------------------------------------------------
function setupMonitoring() {

    var pushButtonLightStyle = 0;

   
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

        //Pin setup for touch sensor interrupt
        var touchInterruptPin = new mraa.Gpio(capacitiveSensorInterruptPin);
        touchInterruptPin.dir(mraa.DIR_IN);
        setTimeout(function () {
            touchInterruptPin.isr(mraa.EDGE_BOTH, irqTouchCallback);
        }, 1000);

    }
    else {
        logger(" !!!!!!!!!!!!!!!!!! NO TOUCH SENSOR !!!!!!!!!!!!!!!!");
        logError.appendFileSync(ErrorLogFileName, "Touch sensor not responding, might be damaged. On " + new Date().getTime() + '\n', encoding = 'utf8',
            function (err) {
                console.error("Error log failing , critical error");
            });
    }


    gyroAccelCompass = new IMUClass.LSM9DS0();

    if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_WHO_AM_I_G) != 255) {
        logger("MOTION SENSOR OK");
        gyroAccelCompass.init();                          // Initialize the device with default values
        setupGyroscope();
        setupAccelerometer();

        var gyrocsopeInterrupt = new mraa.Gpio(GyroscopeInterruptPin);
        gyrocsopeInterrupt.dir(mraa.DIR_IN);
        var horizontalPositionInterrupt = new mraa.Gpio(horizontalPositionInterruptPin);
        horizontalPositionInterrupt.dir(mraa.DIR_IN);
        var moduleTransportationInterrupt = new mraa.Gpio(moduleIsBeingTransportedInterruptPin);
        horizontalPositionInterrupt.dir(mraa.DIR_IN);

        setTimeout(function () {
            gyrocsopeInterrupt.isr(mraa.EDGE_BOTH, gyroInterruptCallBack);
            horizontalPositionInterrupt.isr(mraa.EDGE_BOTH, horizontalPositionCallBack);
            moduleTransportationInterrupt.isr(mraa.EDGE_BOTH, moduleTransportationCallBack);
        }, delayBeforeActivatingAllSensors);
    }
    else {
        logger(" !!!!!!!!!!!!!!!!!! NO MOTION SENSOR !!!!!!!!!!!!!!!!");
        IMUSensorIsDamaged = true;
    }

    showHardwareStateOnButton();


    appState = "active";
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

    touchI2c.writeReg(0x5e,0x0); // set all touch pins to 0

    touchI2c.writeReg(0x2b,0x01); // set baseline data
    touchI2c.writeReg(0x2c,0x01); // set baseline data
    touchI2c.writeReg(0x2d,0x0); // set baseline data
    touchI2c.writeReg(0x2e,0x0); // set baseline data

    touchI2c.writeReg(0x2f,0x01); // set filter data lower than baseline
    touchI2c.writeReg(0x30,0x01); // set filter data lower than baseline
    touchI2c.writeReg(0x31,0xff); // set filter data lower than baseline
    touchI2c.writeReg(0x32,0x02); // set filter data lower than baseline

    touchI2c.writeReg(0x41, 0x0f); //touch threshold
    touchI2c.writeReg(0x42, 0x0a); //touch threshold

    touchI2c.writeReg(0x43, 0x0f); //touch threshold
    touchI2c.writeReg(0x44, 0x0a); //touch threshold
    touchI2c.writeReg(0x45, 0x0f); //touch threshold
    touchI2c.writeReg(0x46, 0x0a); //touch threshold
    touchI2c.writeReg(0x47, 0x0f); //touch threshold
    touchI2c.writeReg(0x48, 0x0a); //touch threshold
    touchI2c.writeReg(0x49, 0x0f); //touch threshold
    touchI2c.writeReg(0x4A, 0x0a); //touch threshold
    touchI2c.writeReg(0x4B, 0x0f); //touch threshold
    touchI2c.writeReg(0x4C, 0x0a); //touch threshold
    touchI2c.writeReg(0x4D, 0x0f); //touch threshold
    touchI2c.writeReg(0x4E, 0x0a); //touch threshold
    touchI2c.writeReg(0x4F, 0x0f); //touch threshold
    touchI2c.writeReg(0x50, 0x0a); //touch threshold
    touchI2c.writeReg(0x51, 0x0f); //touch threshold
    touchI2c.writeReg(0x52, 0x0a); //touch threshold
    touchI2c.writeReg(0x53, 0x0f); //touch threshold
    touchI2c.writeReg(0x54, 0x0a); //touch threshold
    touchI2c.writeReg(0x55, 0x0f); //touch threshold
    touchI2c.writeReg(0x56, 0x0a); //touch threshold
    touchI2c.writeReg(0x57, 0x0f); //touch threshold
    touchI2c.writeReg(0x58, 0x0a); //touch threshold

    touchI2c.writeReg(0x5D, 0x04); //filter configuration

    touchI2c.writeReg(0x7b, 0x0b); //Autoconfiguration registers

    touchI2c.writeReg(0x7d, 0x9c); //Autoconfiguration registers
    touchI2c.writeReg(0x7e, 0x65); //Autoconfiguration registers
    touchI2c.writeReg(0x7f, 0x8c); //Autoconfiguration registers

    touchI2c.writeReg(0x5e, 0x01); //this step is always LAST, only pin 0 is O


    var i2c = new mraa.I2c(touchSensorDriver.MPR121_I2C_BUS);
    i2c.frequency(mraa.I2C_FAST);
    i2c.address(touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);
    i2c.writeReg(touchThresholdAddress, touchThreshold);
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
