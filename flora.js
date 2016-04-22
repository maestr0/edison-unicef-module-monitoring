//// LSM9DS0
//console.log("LSM9DS0 started");
//var imulib = require('edison_imu');
//var imu = new imulib.LSM9DS0(0x6B,0x1D);
//var imuResult = imu.begin();
//
//console.log('Chip id %x',imuResult);
//
//console.log("readAccel=" + imu.readAccel());


var sensorObj = require('jsupm_lsm9ds0');
// Instantiate an LSM9DS0 using default parameters (bus 1, gyro addr 6b,
// xm addr 1d)
var sensor = new sensorObj.LSM9DS0();

// Initialize the device with default values
sensor.init();

var x = new sensorObj.new_floatp();
var y = new sensorObj.new_floatp();
var z = new sensorObj.new_floatp();

// Output data every half second until interrupted
setInterval(function()
{
    sensor.update();

    sensor.getAccelerometer(x, y, z);
    console.log("Accelerometer: AX: " + sensorObj.floatp_value(x) +
                " AY: " + sensorObj.floatp_value(y) +
                " AZ: " + sensorObj.floatp_value(z));

    sensor.getGyroscope(x, y, z);
    console.log("Gyroscope:     GX: " + sensorObj.floatp_value(x) +
                " AY: " + sensorObj.floatp_value(y) +
                " AZ: " + sensorObj.floatp_value(z));

    sensor.getMagnetometer(x, y, z);
    console.log("Magnetometer:  MX: " + sensorObj.floatp_value(x) +
                " MY: " + sensorObj.floatp_value(y) +
                " MZ: " + sensorObj.floatp_value(z));

    console.log("Temperature:   " + sensor.getTemperature());

    console.log();

}, 500);

// exit on ^C
process.on('SIGINT', function()
{
    sensor = null;
    sensorObj.cleanUp();
    sensorObj = null;
    console.log("Exiting.");
    process.exit(0);
});
