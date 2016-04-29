import mraa
import time
import sys

class Counter:
    count = 0

c = Counter()

# inside a python interrupt you cannot use 'basic' types so you'll need to use
# objects
def test(gpio):
    print("pin " + repr(gpio.getPin(True)) + " = " + repr(gpio.read()))
    c.count+=1

pin = 6;
if (len(sys.argv) == 2):
    try:
        pin = int(sys.argv[1], 10)
    except ValueError:
        printf("Invalid pin " + sys.argv[1])
try:
    x = mraa.Gpio(pin)
    print("Starting ISR for pin ")
    x.dir(mraa.DIR_IN)
    x.isr(mraa.EDGE_BOTH, test, x)
    #var = raw_input("Press ENTER to stop")
    #x.isrExit()
except ValueError as e:
    print(e)