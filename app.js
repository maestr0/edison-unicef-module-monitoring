var appVersion = 16;

var mraa = require('mraa');
var express = require('express');
var logFile = require('fs');
var logError = require('fs');
var fs = require('fs');
var SerialPort = require("serialport").SerialPort;
var touchSensorDriver = require('jsupm_mpr121');
var IMUClass = require('jsupm_lsm9ds0');  // Instantiate an LSM9DS0 using default parameters (bus 1, gyro addr 6b, xm addr 1d)
var exec = require('child_process').exec;

var appState = "initialize";

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

// FIXME
// appMode = process.env.NODE_ENV || "development";
appMode = "development";

console.log("APP MODE " + appMode);

videoDuration = (appMode === "production") ? "40" : "5";

var moduleIsHorizontal = false;
var dataFileNamePrefix = generateID();
var gyroRunLoopInterval = 1000; // in milliseconds
var soapRunLoopInterval = 100; // in milliseconds

var gyroZaxisTransient = 0x20; //0o00100000 ;/
var gyroZaxisLatchedHigh = 0x60; //01100000 ;
var gyroZaxisLatchedBoth = 0x70; //01100000 ;
var gyroInterruptActive = 0x80; // 10000000 ;
var weAreRotating = 0x60; //0x40 is interrupt triggered
var touchThresholdAddress = 0x41; // address to set the touch threshold,
var touchThreshold = 255; // lowest sensitivity

var tippyTapID = "XX"; //TODO: we need a way to read the tippy tap id number to add it to fileNames
var touchDataID = 0;  //TODO: we need a way to read the latest data id for touchnumber to add it to fileNames

var ErrorLogFileName = moduleDataPath + "/error.log";
var templateDataLogTouch = serialNumber + ",C,";

var serialPath = "/dev/ttyMFD2";
var i2c;
var serialPort;
var powerBoost;
var touchSensor;
var soapSensorIsDamaged = false;
var IMUSensorIsDamaged = false;
var gyroAccelCompass; //= new IMUClass.LSM9DS0()  ;
var app;


setupMonitoring();


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
            // CAPACITIVE SENSOR STATUS SYSTEM ------------
            if (!touchSensorWorks()) {
                errorStatus = "Touch sensor damaged";
                sensorsOverallStatus = "FAIL";
            }

            break;

        case "touch" :  // IMU SENSOR STATUS SYSTEM ------------
            if (isEmpty(gyroAccelCompass)) {
                errorStatus = "IMU damaged. ";
                sensorsOverallStatus = "FAIL";
            }
            else {
                if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_WHO_AM_I_G) === 255) {
                    errorStatus += "Gyroscope unreachable. "; // if chip failed return false all the time
                    sensorsOverallStatus = "ERROR";
                }
                if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_WHO_AM_I_XM) === 255) {
                    errorStatus += "Accelerometer unreachable. "; // if chip failed return false all the time
                    sensorsOverallStatus = "ERROR";
                }
            }

            break;
    }


    appState = "active"; // FIXME: what is this for?

    res.send({
        "status": sensorsOverallStatus,
        "error": errorStatus
    });
});

app.listen(app.get('port'), function () {
    console.log('Monitoring listening on port ' + app.get('port'));
});

serialPort.on("open", function () {
    serialPort.write("Starting monitoring app v" + appVersion + "\n\r", function (err, results) { //Write data
    });
});


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


var takingPictures = false;

var takePicture = function () {
    logger(" ...Taking pictures... ");

    var command = scriptsPath + "/capture.sh " + dataFileNamePrefix + " " + videoDuration;

    exec(command, {timeout: 60000}, function (error, stdout, stderr) {

        if (!error) {
            logger("image captured successfully");
            msg = "image captured successfully";
        } else {

            console.error("shit happened with the camera " + stderr);
            msg = "ERROR: shit happened " + stderr;

        }

        powerUsbPortOff();
        var oldDataFileNamePrefix = dataFileNamePrefix;
        dataFileNamePrefix = generateID();

        logger("about to archive...");

        exec(scriptsPath + "/archive.sh " + oldDataFileNamePrefix, {timeout: 60000}, function (error, stdout, stderr) {
            if (!error) {
                logger("PAWEL IS PERFECT !!!!  ------------------------ archive completed" + stdout);

                exec(scriptsPath + "/sleep.sh ", {timeout: 60000}, function (error, stdout, stderr) {
                    if (error) {
                        logger("---- WE CANNOT SLEEP -----");
                    }
                });

            }
            else {

                console.error("shit happened with the archiver " + stderr);
                msg = "ERROR: shit happened " + stderr;
            }


        });

        takingPictures = false;

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


//---------------------- RUN LOOPS --------------------------
var powerUsbPortOn = function () {
    logger("about to set 1 on POWER BOOST pin");
    powerBoost.write(1);
    logger("soap wire touched, boost power to 5v");
};

var powerUsbPortOff = function () {
    powerBoost.write(0);
    logger("Back to 3.3 v");
};

setInterval(function () {
    logger("state: " + appState);
}, 5000);


//------- SOAP TOUCHING
setInterval(function () {


    if (soapHasBeenTouched()) {

        powerUsbPortOn();

        if (!takingPictures) {

            takingPictures = true;
            appState = "busy";
            setTimeout(takePicture, 3000);

        }

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


        //queue.push("button pressed @ " + new Date().getTime());
    }
}, soapRunLoopInterval);


function startAccessPoint() {
    exec(scriptsPath + "/startAp.sh ", {timeout: 60000}, function (error, stdout, stderr) {

        if (error) {
            appState = "active";
            logger("about to reboot " + error + ' --- ' + stderr); //FIXME: needs actual reboot here
        } else {
            logger("in AP mode " + stdout);
            appState = "disabled";
        }
    });

}

function accesspointTimeoutReboot() {
    setTimeout(function () {
        logger("ap timed out");

        exec(process.env.SCRIPTS + "/stopAp.sh ", function (error, stdout, stderr) {

            if (error) {
                moduleIsHorizontal = false;
                appState = "active";
                logger("about to reboot since stopping AP didn't work " + error + ' --- ' + stderr); //FIXME: needs actual reboot here
            } else {
                logger("... AP mode stopped " + stdout);
                moduleIsHorizontal = false;
                appState = "active";
            }
        });


        //FIXME: implement reboot here oui
    }, 1 * 60 * 1000); //1 minutes
}


//------- WATER CONTAINER ROTATION
setInterval(function () {
    if (appState != "disabled") {
        if (moduleIsHorizontal) {
            durationInHorizontalPosition++;
            if (durationInHorizontalPosition === 5) {
                startAccessPoint();
                accesspointTimeoutReboot();
            }
            gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_2_SRC);
            gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_SRC);
            moduleIsHorizontal = false;
        }
        else {
            durationInHorizontalPosition = 0;
        }
    }
}, 1000);

setInterval(function () {

    //if ( thereIsARotation()) {
    // logger( gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_XM , IMUClass.LSM9DS0.REG_WHO_AM_I_XM )); // if chip failed return false all the time
    // logger( gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_WHO_AM_I_G )); // if chip failed return false all the time

    //console.log( "Rotation detected");
    gyroAccelCompass.update();

    var x = new IMUClass.new_floatp();
    var y = new IMUClass.new_floatp();
    var z = new IMUClass.new_floatp();
    gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_2_SRC);
    gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_SRC);
    //logger("Origin int GEN2: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_2_SRC).toString(16) + ". " +
    //  "Origin int GEN1: 0x" + gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_SRC).toString(16));// + ". "+
    //"Origin INTG: 0x"+ gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_SRC_G).toString(16) );

    gyroAccelCompass.getGyroscope(x, y, z);
    var gyroData = "Gyroscope:     GX: " + Math.round(IMUClass.floatp_value(x)) + " AY: " + Math.round(IMUClass.floatp_value(y)) + " AZ: " + Math.round(IMUClass.floatp_value(z));

    //logger(gyroData);


    gyroAccelCompass.getAccelerometer(x, y, z);
    //logger("Accelerometer: AX: " + IMUClass.floatp_value(x) + " AY: " + IMUClass.floatp_value(y) +  " AZ: " + IMUClass.floatp_value(z));


    if (!takingPictures) {
        // takingPictures = true;
        //takePicture();

    }
    //}

}, gyroRunLoopInterval);


//---------------------- IRQ CALLBACK --------------------------

function irqTouchCallback() {
    // Leave this callback empty, only for waking up the device
    logger("-Touch detected by ISR");
}

function gyroInterruptCallBack() {
    // Leave this callback empty, only for waking up the device
    logger("Rotation detected by ISR !!!!");
}

function horizontalPositionCallBack() {
    logger("Module detected in horizontal position by ISR !!!!");
}

function moduleTransportationCallBack() {
    //if (moduleIsHorizontal === false)
    logger("Module transportation detected by ISR !!!!" + new Date().getTime());

    moduleIsHorizontal = true;

}
//----------------- UTILITY FUNCTIONS --------------------------

function soapHasBeenTouched() {
    if (soapSensorIsDamaged) return false;
    touchSensor.readButtons();
    var isTouched = touchSensor.m_buttonStates & 1;
    if (isTouched) logger("soap");
    return (isTouched);
}

function setupGyroscope() {

    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_CFG_G, 0x08); // enable interrupt only on Y axis
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG1_G, 0x0A);// Y axis enabled only
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG2_G, 0x00);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG3_G, 0x80);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG5_G, 0x00);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_TSH_YH_G, 0x25); // 0x25 ); //set threshold for high rotation speed per AXIS, TSH_YH_G is for Y axis only!

    showGyrodebugInfo();

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

    //Setup interrupt 1 for horizontal position for more than 5 seconds
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_INT_GEN_1_REG, 0x20);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG0_XM, 0x00); //default value
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG1_XM, 0x67); //0x64); //set Frequency of accelero sensing (ODR is 100 Hz) and axis enabled (z)

    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG2_XM, 0x00); // Set accelero scale to 2g
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG3_XM, 0x20); //enable pinXM for acclero interrupt
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_XM, IMUClass.LSM9DS0.REG_CTRL_REG5_XM, 0x03);

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


//-----------------------------------------------------------------------------------------------------------
function setupMonitoring() {

    var pushButtonLightStyle = 0;

    //------------------ initialize serial port
    serialPort = new SerialPort(serialPath, {
        baudrate: 115200
    });

    logger(appState);

    //------------------ initialize server for hardware status report
    app = express();
    app.set('port', (process.env.MONITORING_PORT || 3001));


    //------------------ initialize power booster to OFF
    powerBoost = new mraa.Gpio(voltageBoostPin);
    powerBoost.dir(mraa.DIR_OUT);
    powerBoost.write(0);

    touchSensor = new touchSensorDriver.MPR121(touchSensorDriver.MPR121_I2C_BUS, touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);

    if (touchSensorWorks()) {
        logger("TOUCH SENSOR OK");
        touchSensor.configAN3944();
        var i2c = new mraa.I2c(touchSensorDriver.MPR121_I2C_BUS);
        i2c.address(touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);
        i2c.writeReg(touchThresholdAddress, touchThreshold);

        //Pin setup for touch sensor interrupt
        var touchInterruptPin = new mraa.Gpio(capacitiveSensorInterruptPin);
        touchInterruptPin.dir(mraa.DIR_IN);
        setTimeout(function () {
            touchInterruptPin.isr(mraa.EDGE_BOTH, irqTouchCallback);
        }, 500);

    }
    else {
        console.error("NO TOUCH SENSOR");
        logError.appendFileSync(ErrorLogFileName, "Touch sensor not responding, might be damaged. On " + new Date().getTime() + '\n', encoding = 'utf8',
            function (err) {
                console.error("Error log failing , critical error");
            });
    }


    gyroAccelCompass = new IMUClass.LSM9DS0();

    if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_WHO_AM_I_G) === 255) {
        IMUSensorIsDamaged = true;
        console.error("NO GYROSCOPE");
    }
    else {
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
            horizontalPositionInterrupt.isr(mraa.EDGE_BOTH, moduleTransportationCallBack);
        }, 500);
    }


    var pushButtonLight = new mraa.Gpio(pushButtonLightPin);
    pushButtonLight.dir(mraa.DIR_OUT);
    if (!(soapSensorIsDamaged || IMUSensorIsDamaged))pushButtonLight.write(1);

    setTimeout(function () {
        pushButtonLight.write(0);
    }, 5000);

    logger("Starting monitoring app v" + appVersion + "\n\r");
    appState = "active";
}


function touchSensorWorks() {
    touchI2c = new mraa.I2c(touchSensorDriver.MPR121_I2C_BUS);
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

function generateID() {
    var randomString = Math.random().toString(36).substring(10);
    return rebootCount + '_' + currentDate() + '_' + randomString;

}


function initRebootCount() {

    fs.readFile(process.env.REBOOT_COUNT_PATH, "UTF8", function (err, data) {
        logger(self.rebootCount + " vasa" + rebootCount);
        self.rebootCount = 1;
        if (err) {
            console.log("error reboot count");
            self.rebootCount = "REBOOT_COUNT_UNDEFINED_";
        }

        try {
            self.rebootCount = parseInt(data) + "";
            rebootCount = self.rebootCount;
            console.log("reboot count ok " + self.rebootCount);
            console.log("reboot itself : " + rebootCount);

        } catch (e) {
            console.log("invalid reboot count");
            self.rebootCount = "REBOOT_COUNT_INVALID_";
        }
    });
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
