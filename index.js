var mraa = require('mraa');
var exec = require('child_process').exec;
var touchSensorDriver = require('jsupm_mpr121');

var touchSensor = new touchSensorDriver.MPR121(touchSensorDriver.MPR121_I2C_BUS, touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);
touchSensor.configAN3944();

var touchInterruptPin = new mraa.Gpio(8);
touchInterruptPin.dir(mraa.DIR_IN);
touchInterruptPin.isr(mraa.EDGE_BOTH, isrCallback);

var isrReady = true;

function isrCallback() {
    if (isrReady) {
        isrReady = false;
        logger("ISR callback()");
        setTimeout(armIsr, 2000);
    }
}

function armIsr() {
    isrReady = true;
}

function logger(msg) {
    console.log(msg);
}

function sleep() {
    var command = "/home/root/scripts/sleep.sh";
    exec(command, function (error, stdout, stderr) {
        if (!error) {
            logger("Command " + command + " executed successfully\n" + stdout);
        } else {
            logger("ERROR  " + stderr + stderr);
        }
    });
}

function heartbeat() {
    logger("beep");
}

setInterval(heartbeat, 2000);




