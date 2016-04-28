var logFile = require('fs');
var logError = require('fs');

var gyroRunLoopInterval = 500; // in milliseconds
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
var dataLogFileDirectory = "/media/sdcard/";
var ErrorLogFileName = "/home/root/log/error.log"
var dataLogFileName = dataLogFileDirectory + "currentTouchData";
var templateDataLogTouch = tippyTapID + ",C,";

var appVersion = 16;


console.log("Starting monitoring app v" + appVersion + "\n\r");
var serialPath = "/dev/ttyMFD2";
var SerialPort = require("serialport").SerialPort;
var serialPort = new SerialPort(serialPath, {
    baudrate: 115200
});

serialPort.on("open", function () {

    serialPort.write("Starting monitoring app v" + appVersion + "\n\r", function (err, results) { //Write data
    });
});


var mraa = require('mraa');

var uart = new mraa.Uart(0); //Default


//---------------------------------------------
// TESTING POWER BOOST

var powerBoostPin = new mraa.Gpio(12);
powerBoostPin.dir(mraa.DIR_OUT);


powerBoostPin.write(0);


var touchSensorDriver = require('jsupm_mpr121');
var touchSensor = new touchSensorDriver.MPR121(touchSensorDriver.MPR121_I2C_BUS, touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);


// --- Use wire here since UPM jsupm_mpr121 has a bug on writeRegisters function --------------------- //
var i2c = new mraa.I2c(touchSensorDriver.MPR121_I2C_BUS);
i2c.address(touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);


if (i2c.readReg(0x5C) != 0) {
    touchSensor.configAN3944();
    i2c.writeReg(touchThresholdAddress, touchThreshold);

    //Pin setup for touch sensor interrupt
    var touchInterruptPin = new mraa.Gpio(8);
    touchInterruptPin.dir(mraa.DIR_IN);
    touchInterruptPin.isr(mraa.EDGE_BOTH, irqTouchCallback);
} else {
    console.error("NO TOUCH SENSOR");
    logError.appendFileSync(ErrorLogFileName, "Touch sensor not responding, might be damaged. On " + new Date().getTime() + '\n', encoding = 'utf8',
        function (err) {
            console.error("Error log failing , critical error");
        });
}


var IMUClass = require('jsupm_lsm9ds0');  // Instantiate an LSM9DS0 using default parameters (bus 1, gyro addr 6b, xm addr 1d)
var gyroAccelCompass = new IMUClass.LSM9DS0();

if (isEmpty(gyroAccelCompass)) {
    console.error("NO GYROSCOPE");
} else {
    gyroAccelCompass.init();                          // Initialize the device with default values
    setupGyroscope();
    //Pin setup for gyroscope interrupt
    var gyroInterruptPin = new mraa.Gpio(13);
    gyroInterruptPin.dir(mraa.DIR_IN);
    gyroInterruptPin.isr(mraa.EDGE_BOTH, gyroInterruptCallBack);


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

var takingPictures = false;
var exec = require('child_process').exec;

var takePicture = function () {

    console.log("\n\r ...Taking pictures... ");

    serialPort.write("\n\r ...Taking pictures... \n\r", function (err, results) {
    });


    var command = "/home/root/ffmpeg/ffmpeg -an -r 4 -s 1024x768 -f video4linux2 -ss 5 -i /dev/video0 -vframes 200 /media/sdcard/images/node-test-%3d.jpeg";

    // for movie
    //var command = "/home/root/ffmpeg/ffmpeg -s 1024x768 -f video4linux2  -i /dev/video0 -f mpeg1video -b:v 800k  -t 34 /media/sdcard/images/out.mpg";
    //var command = "/home/root/ffmpeg/ffmpeg -s 1024x768 -f video4linux2  -i /dev/video0 -f mpeg1video -b 800k -r 2 -t 10 /home/root/out.mpg";

    exec(command, function (error, stdout, stderr) {

        if (!error) {
            serialPort.write("image captured successfully", function (err, results) {
            });
            console.log(" images captured successfully");
            msg = "image captured successfully";
        } else {

            console.error("shit happened with the camera " + stderr);
            msg = "ERROR: shit happened " + stderr;

        }

        powerUsbPortOff();

        takingPictures = false;

        logFile.appendFile('/home/root/camera.txt', msg + '\n', encoding = 'utf8',
            function (err) {
                if (err) {
                    console.error("shit happened with the file writter");
                    throw err;
                }
            });
    });
};


//---------------------- RUN LOOPS --------------------------
var powerUsbPortOn = function () {
    powerBoostPin.write(1);
    console.log("soap wire touched, boost power to 5v");
    serialPort.write("wire pressed @ " + new Date().getTime(), function (err, results) {
    });
};

var powerUsbPortOff = function () {
    powerBoostPin.write(0);
    console.log("Back to 3.3 v");
    serialPort.write("Back to 3.3 v ", function (err, results) {
    });

};

setInterval(function () {
    console.log("alive \n");
    serialPort.write("alive\n\r", function (err, results) {
    });

}, 2000);


//------- SOAP TOUCHING
setInterval(function () {


    if (soapHasBeenTouched()) {

        powerUsbPortOn();

        if (!takingPictures) {

            takingPictures = true;
            setTimeout(takePicture, 3000);

        }

        logFile.appendFile(dataLogFileName, templateDataLogTouch + touchDataID + ',' + Date.now() + '\n', encoding = 'utf8',
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


//------- WATER CONTAINER ROTATION
setInterval(function () {

    if (thereIsARotation()) {
        console.log("Rotation detected");
        gyroAccelCompass.update();

        var x = new IMUClass.new_floatp();
        var y = new IMUClass.new_floatp();
        var z = new IMUClass.new_floatp();
        gyroAccelCompass.getGyroscope(x, y, z);
        var gyroData = "Gyroscope:     GX: " + Math.round(IMUClass.floatp_value(x)) + " AY: " + Math.round(IMUClass.floatp_value(y)) + " AZ: " + Math.round(IMUClass.floatp_value(z));
        console.log(gyroData);

        if (!takingPictures) {
            // takingPictures = true;
            //takePicture();

        }
    }

}, gyroRunLoopInterval);


//---------------------- IRQ CALLBACK --------------------------

function irqTouchCallback() {

    // Leave this callback empty, only for waking up the device
    console.log("irqTouchCallback \n");
    serialPort.write("Touched !!!!\n\r", function (err, results) {
    });


}

function gyroInterruptCallBack() {
    // Leave this callback empty, only for waking up the device
    //console.log("gyroIRQ callback " + new Date().getTime());
}

function logger(msg) {
    serialPort.write(msg + "\n\r", function (err, results) {
    });
    console.log(msg);
}
//----------------- UTILITY FUNCTIONS --------------------------

function soapHasBeenTouched() {
    if (i2c.readReg(0x5C) === 0) {
        logger("i2c is fucked");
    }

    touchSensor.readButtons();

    var isTouched = touchSensor.m_buttonStates;
    logger("isTouch status:" + isTouched);
    if (isTouched) {
        logger("soap");

        return true;
    } else {

        return false;
    }
}

function setupGyroscope() {
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_CFG_G, 0x60);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG1_G, 0x0F);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG2_G, 0x00);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG3_G, 0x88);
    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_CTRL_REG5_G, 0x00);

    gyroAccelCompass.writeReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_TSH_ZH_G, 0x25); //set threshold for high rotation speed


}

function thereIsARotation() {
    if (gyroAccelCompass.readReg(IMUClass.LSM9DS0.DEV_GYRO, IMUClass.LSM9DS0.REG_INT1_SRC_G) >= weAreRotating) return true;
    return false;
}

function showGyrodebugInfo() {
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