var mraa = require('mraa');
var exec = require('child_process').exec;
var touchSensorDriver = require('jsupm_mpr121');

var touchSensor = new touchSensorDriver.MPR121(touchSensorDriver.MPR121_I2C_BUS, touchSensorDriver.MPR121_DEFAULT_I2C_ADDR);
touchSensor.configAN3944();

var touchInterruptPin = new mraa.Gpio(8);
touchInterruptPin.dir(mraa.DIR_IN);
touchInterruptPin.isr(mraa.EDGE_BOTH, isrCallback);

function isrCallback() {
    // DO NOT ADD ANYTHING HERE, EVEN THE LOGGER CRASHES IT!!!
}
logger("START MONITORING");

main();

function main() {
    logger("Collecting data for 5s");
    startCapturingTouchSensorData();
    captureVideo(function () {
        stopCapturingTouchSensorData();
        logger("Video captured. Going to sleep...");
        sleep(function () {
            main();
        }, function () {
            logger("Unable to sleep. Rebooting... (NOT IMPLEMENTED)");
            // reboot here or something
            main();
        });
    }, function () {
        stopCapturingTouchSensorData();
        logger("ERROR when capturing video. Rebooting... (NOT IMPLEMENTED)");
        main();
    });
}

function startCapturingTouchSensorData() {
    logger("START capturing touch sensor data");
}

function stopCapturingTouchSensorData() {
    logger("STOP capturing touch sensor data");
}

function sleep(callbackOk, callbackError) {
    var command = "/home/root/scripts/sleep.sh";
    exec(command, function (error, stdout, stderr) {
        if (!error) {
            callbackOk();
        } else {
            logger("ERROR  " + stderr + stderr);
            callbackError();
        }
    });
}

function captureVideo(callbackOk, callbackError) {
    var command = "./scripts/fakeFfmpeg.sh";
    exec(command, function (error, stdout, stderr) {
        if (!error) {
            callbackOk(stdout);
        } else {
            logger("ERROR  " + stderr + " - " + error);
            callbackError(stderr);
        }
    });
}

function logger(msg) {
    console.log(msg);
}

function heartbeat() {
    logger("beep");
}

setInterval(heartbeat, 10000);




