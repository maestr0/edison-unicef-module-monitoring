// HTTP server just for status
var express = require('express');
var app = express();

app.get('/', function (req, res) {
  res.send('Monitoring');
});

app.set('port', (process.env.MONITORING_PORT || 3001));

app.listen(app.get('port'), function () {
  console.log('Monitoring listening on port ' + app.get('port'));
});


// **********************
// ACTUAL MONITORING CODE
// **********************


process.env.MODULE_DATA_DIR // /media/sdcard/data
process.env.SCRIPTS // /home/root/scripts

// TODO: add dependencies properly!











// "q": "latest",
// "jsupm_mpr121": "latest"
console.log("starting monitoring app");
var gyroRunLoopInterval   = 500 ; // in milliseconds
var soapRunLoopInterval   = 200 ; // in milliseconds

var gyroZaxisTransient     = 0x20 ; //0o00100000 ;/
var gyroZaxisLatchedHigh   = 0x60 ; //01100000 ;
var gyroZaxisLatchedBoth   = 0x70 ; //01100000 ;
var gyroInterruptActive    = 0x80 ; // 10000000 ;
var weAreRotating          = 0x60 ; //0x40 is interrupt triggered
var touchThresholdAddress  = 0x41 ; // address to set the touch threshold, 

var mraa = require('mraa');

//Pin setup for touch sensor interrupt
var touchInterruptPin = new mraa.Gpio(8);
touchInterruptPin.dir(mraa.DIR_IN);
touchInterruptPin.isr(mraa.EDGE_BOTH, irqCallback);

var touchSensorDriver = require('jsupm_mpr121');
var myTouchSensor = new touchSensorDriver.MPR121(touchSensorDriver.MPR121_I2C_BUS, touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);
myTouchSensor.configAN3944();
var buffer = [128];
var oneByte = new Number(1);

// --- Use wire here since UPM is --------------------- //
var i2c = new mraa.I2c(touchSensorDriver.MPR121_I2C_BUS);  
i2c.address(touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);  
i2c.writeReg(0x41,255);


//Pin setup for gyroscope interrupt
//var gyroInterruptPin =  new mraa.Gpio(13);
//gyroInterruptPin.dir(mraa.DIR_IN);
//gyroInterruptPin.isr(mraa.EDGE_BOTH, gyroInterruptCallBack);


var IMUClass         = require('jsupm_lsm9ds0');  // Instantiate an LSM9DS0 using default parameters (bus 1, gyro addr 6b, xm addr 1d)
var gyroAccelCompass = new IMUClass.LSM9DS0()  ;

if ( isEmpty(gyroAccelCompass)){
    console.error("NO GYROSCOPE");
}
else {
    gyroAccelCompass.init();                          // Initialize the device with default values
    setupGyroscope();
}




var fs1 = require('fs');
var c = 0;
var c2 = 0;
var queue = [];

var processLogQueue = function () {

    console.log("queue processing...");

    var topElement = queue.pop();

    if (topElement) {

        //        fs1.appendFile('/home/root/sleep.txt', topElement + '\n', encoding = 'utf8',
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

var createPackagePrefix = function(){
    // TODO: implement this shit
    var randomPart = Math.random().toString(36).substring(10);
    var rebootCount = "FIXME";
    var datetime = "2016_06_01_134501"; // FIXME
    return rebootCount + "_" + datetime +"_" + randomPart;
}

var takePicture = function () {
    console.log("Taking pictures...");

    var command = process.env.SCRIPTS + "/capture.sh " + createPackagePrefix();
    //var command = "/home/root/bin/ffmpeg/ffmpeg -an -r 4 -s 1024x768 -f video4linux2 -ss 5 -i /dev/video0 -vframes 200 /media/sdcard/node-test-%3d.jpeg";
    // for movie ffmpeg -s 1024x768 -f video4linux2  -i /dev/video0 -f mpeg1video -b 800k -r 30 -t 50 /media/sdcard/images/out.mpg
    exec(command, function (error, stdout, stderr) {

        if (!error) {
            console.log("image captured successfully");
            msg = "image captured successfully";
        } else {
            console.error("shit happened with the camera " + stderr);
            msg = "ERROR: shit happened " + stderr;
        }

        takingPictures = false;

        fs1.appendFile('/home/root/camera.txt', msg + '\n', encoding = 'utf8',
            function (err) {
                if (err) {
                    console.error("shit happened with the file writter");
                    throw err;
                }
            });
    });
};



//---------------------- RUN LOOPS --------------------------


//------- SOAP TOUCHING
setInterval(function () {

    if (soapHasBeenTouched()) {
         console.log("Button pressed @ " + new Date().getTime());
        //queue.push("button pressed @ " + new Date().getTime());
    }
}, soapRunLoopInterval);



//------- WATER CONTAINER ROTATION
setInterval(function () {
    
    if ( thereIsARotation()) {
        console.log( "Rotation detected");
        gyroAccelCompass.update();
        
        var x = new IMUClass.new_floatp();
        var y = new IMUClass.new_floatp();
        var z = new IMUClass.new_floatp();
        gyroAccelCompass.getGyroscope(x, y, z);
        var gyroData = "Gyroscope:     GX: " + Math.round(IMUClass.floatp_value(x)) + " AY: " + Math.round(IMUClass.floatp_value(y)) +" AZ: " + Math.round(IMUClass.floatp_value(z)) ;
        console.log(gyroData);
        
        if (!takingPictures) {
            takingPictures = true;
            takePicture();
        }
    }

}, gyroRunLoopInterval);




//---------------------- IRQ CALLBACK --------------------------

function irqCallback() {
    // Leave this callback empty, only for waking up the device
    // console.log("IRQ callback() " + new Date().getTime());
}

function gyroInterruptCallBack(){    
    // Leave this callback empty, only for waking up the device
    //console.log("gyroIRQ callback " + new Date().getTime());
}



//----------------- UTILITY FUNCTIONS --------------------------

function soapHasBeenTouched() {
    //return false; // TODO : remove this !
    myTouchSensor.readButtons();
    return (myTouchSensor.m_buttonStates & 1);
}

function setupGyroscope(){
gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_CFG_G,  0x60 );
gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG1_G, 0x0F );
gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG2_G, 0x00 );
gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG3_G, 0x88 );
gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG5_G, 0x00 );

gyroAccelCompass.writeReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_TSH_ZH_G, 0x25 ); //set threshold for high rotation speed



}

function thereIsARotation(){
    if (gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_SRC_G ) >= weAreRotating ) return true;
    return false;
}

function showGyrodebugInfo(){
    console.log( "Gyro REG1: 0x" + gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG1_G ).toString(16) );
    console.log( "Gyro REG2: 0x" + gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG2_G ).toString(16) );
    console.log( "Gyro REG3: 0x" + gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG3_G ).toString(16) );
    console.log( "Gyro REG4: 0x" + gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG4_G ).toString(16) );
    console.log( "Gyro REG5: 0x" + gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_CTRL_REG5_G ).toString(16) );
    console.log( "Gyro status" + gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_STATUS_REG_G ).toString(16) );
    console.log( "Gyro FIFO . 0x" + gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_FIFO_CTRL_REG_G ).toString(16) );
    console.log( "Gyro interrupt source: " + gyroAccelCompass.readReg( IMUClass.LSM9DS0.DEV_GYRO , IMUClass.LSM9DS0.REG_INT1_SRC_G ).toString(16) );
}

// ---- UTILITY FUNCTIONS ----------
function isEmpty(obj) {
    for(var prop in obj) {
        if(obj.hasOwnProperty(prop))
            return false;
    }

    return true && JSON.stringify(obj) === JSON.stringify({});
}