const receiver = require('@amperka/ir-receiver').connect(P3);
const projector = require('@amperka/led').connect(P2);

class MovementControl {

    init() {

    }

    set(leftSpeed, rightSpeed) {

    }

    stop() {

    }

    destroy() {

    }

}

class RobotMovementControl extends MovementControl {

    constructor() {
        super();
        this.robot = require('@amperka/robot-2wd').connect();
    }

    set(leftSpeed, rightSpeed) {
        this.robot.go({l: leftSpeed, r: rightSpeed});
    }

    stop() {
        this.robot.stop();
    }

    destroy() {
        this.robot = null;
    }

}

class CruiseControl extends MovementControl {
    constructor(leftPin, rightPin, wheelLength) {
        super();
        const motor = require('@amperka/motor');
        const encoder = require('@amperka/digital-line-sensor');

        this.leftMotor = motor.connect(motor.MotorShield.M1);
        this.rightMotor = motor.connect(motor.MotorShield.M2);

        this.leftEncoder = encoder.connect(leftPin);
        this.rightEncoder = encoder.connect(rightPin);

        this.leftState = this.createState(false);
        this.rightState = this.createState(true);

        this.leftEncoder.on('white', this.createHandler(this.leftMotor, this.leftState));
        this.rightEncoder.on('white', this.createHandler(this.rightMotor, this.rightState));

        this.wheelLength = wheelLength;
    }

    createState(invert) {
        return {
            counter: 0,
            lastTime: getTime(),
            V: 0,
            cruiseSpeed: 0,
            deltaV: 0,
            invert: invert
        };
    }

    createHandler(motor, state) {
        return () => {
            state.counter++;
            if (state.counter % 12 !== 0) return;

            const now = getTime();
            const deltaTime = now - state.lastTime;
            const speed = this.wheelLength / deltaTime / 1000;
            state.lastTime = now;

            if (speed < state.cruiseSpeed && Math.abs(state.V) < 1) {
                state.V += state.deltaV;
            } else if (speed > state.cruiseSpeed && Math.abs(state.V) > 0) {
                state.V -= state.deltaV;
            }
            motor.write(state.V * (this.invert ? -1 : 1));
        };
    }

    set(leftSpeed, rightSpeed) {
        this.leftState.V = leftSpeed;
        this.rightState.V = rightSpeed;

        this.leftState.cruiseSpeed = Math.abs(leftSpeed);
        this.rightState.cruiseSpeed = Math.abs(rightSpeed);

        this.leftState.deltaV = leftSpeed >= 0 ? 0.01 : -0.01;
        this.rightState.deltaV = rightSpeed >= 0 ? 0.01 : -0.01;

        this.leftMotor.write(leftSpeed);
        this.rightMotor.write(-rightSpeed);
    }

    stop() {
        this.set(0, 0);
    }

    destroy() {
        this.leftMotor = null;
        this.rightMotor = null;
        this.leftEncoder = null;
        this.rightEncoder = null;
    }
}

class HeadController {
    constructor() {
        this.neck = require('@amperka/servo').connect(P8);
        this.enabled = false;
        this.angle = 90;
        this.step = 10;
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.enabled) {
            projector.blink(0.5, 0.5);
        } else {
            projector.turnOff();
        }
        console.log('Head rotation is', this.enabled);
    }

    isEnabled() {
        return this.enabled;
    }

    move(code) {
        if (!this.enabled) return;

        switch (code) {
            case receiver.keys.LEFT:
                if (this.angle >= 30) this.angle -= this.step;
                break;
            case receiver.keys.RIGHT:
                if (this.angle <= 150) this.angle += this.step;
                break;
            case receiver.keys.TOP:
                this.angle = 90;
                break;
            case receiver.keys.TOP_LEFT:
                this.angle = 60;
                break;
            case receiver.keys.TOP_RIGHT:
                this.angle = 120;
                break;
            default:
                return;
        }
        this.neck.write(this.angle);
    }
}

class Mode {
    constructor(controller) {
        this.controller = controller;
    }

    start() {
    }

    stop() {
    }

    handleIR(code) {
    }
}

class ManualMode extends Mode {
    start() {
        console.log('Mode: MANUAL');
    }

    stop() {
        this.controller.movement.stop();
    }

    handleIR(code) {
        if (!this.controller.state.on || this.controller.head.isEnabled()) {
            return;
        }
        const speed = this.controller.state.speed;
        switch (code) {
            case receiver.keys.LEFT:
                this.controller.movement.set(0, speed);
                projector.turnOff();
                break;
            case receiver.keys.RIGHT:
                this.controller.movement.set(speed, 0);
                projector.turnOff();
                break;
            case receiver.keys.TOP:
                this.controller.movement.set(speed, speed);
                projector.turnOff();
                break;
            case receiver.keys.BOTTOM:
                this.controller.movement.set(-speed, -speed);
                projector.turnOn();
                break;
            case receiver.keys.TOP_LEFT:
                this.controller.movement.set(-speed, speed);
                projector.turnOff();
                break;
            case receiver.keys.BOTTOM_RIGHT:
                this.controller.movement.set(-speed, speed);
                projector.turnOn();
                break;
            case receiver.keys.TOP_RIGHT:
                this.controller.movement.set(speed, -speed);
                projector.turnOff();
                break;
            case receiver.keys.BOTTOM_LEFT:
                this.controller.movement.set(speed, -speed);
                projector.turnOn();
                break;
            case receiver.keys.PLAY:
                this.controller.movement.stop();
                projector.turnOff();
                break;
        }
    }
}

class HoldMode extends Mode {
    constructor(controller) {
        super(controller);
        this.timeout = null;
    }

    start() {
        console.log('Mode: HOLD');
    }

    stop() {
        this.clearHold();
        this.controller.movement.stop();
    }

    clearHold() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }

    handleIR(code) {
        if (!this.controller.state.on || this.controller.head.isEnabled()) {
            return;
        }

        const speed = this.controller.state.speed;

        const drive = (left, right) => {
            this.controller.movement.set(left, right);
            if (this.timeout) clearTimeout(this.timeout);
            this.timeout = setTimeout(() => {
                this.controller.movement.stop();
                this.timeout = null;
            }, 500);
        };

        switch (code) {
            case receiver.keys.TOP:
                drive(speed, speed);
                break;
            case receiver.keys.BOTTOM:
                drive(-speed, -speed);
                break;
            case receiver.keys.LEFT:
                drive(0, speed);
                break;
            case receiver.keys.RIGHT:
                drive(speed, 0);
                break;
            case receiver.keys.TOP_LEFT:
                drive(-speed, speed);
                break;
            case receiver.keys.TOP_RIGHT:
                drive(speed, -speed);
                break;
            case receiver.keys.BOTTOM_LEFT:
                drive(speed, -speed);
                break;
            case receiver.keys.BOTTOM_RIGHT:
                drive(-speed, speed);
                break;
            case receiver.keys.PLAY:
                this.controller.movement.stop();
                if (this.timeout) clearTimeout(this.timeout);
                this.timeout = null;
                break;
        }
    }

}

class AutoMode extends Mode {
    constructor(controller) {
        super(controller);
        this.ultrasonic = null;
        this.interval = null;

        this.DISTANCE_MIN = 10;
        this.DISTANCE_MAX = 14;
    }

    start() {
        console.log('Mode: AUTO');
        const ultrasonicLib = require('@amperka/ultrasonic');
        this.ultrasonic = ultrasonicLib.connect({
            trigPin: P12,
            echoPin: P13
        });
        this.interval = setInterval(() => {
            if (!this.controller.state.on) return;
            this.ultrasonic.ping((err, dist) => {
                if (!err) {
                    this.check(dist);
                }
            }, 'cm');
        }, 100);
    }

    stop() {
        clearInterval(this.interval);
        this.ultrasonic = null;
        projector.turnOff();
        this.controller.movement.stop();
    }

    check(distance) {
        const speed = this.controller.state.speed;
        if (distance > this.DISTANCE_MAX) {
            this.controller.movement.set(speed, speed);
            projector.turnOff();
        } else if (distance < this.DISTANCE_MIN) {
            this.controller.movement.set(-speed, -speed);
            projector.turnOn();
        } else {
            this.controller.movement.stop();
            projector.turnOff();
        }
    }
}

class LineMode extends Mode {
    constructor(controller) {
        super(controller);
        this.timer = null;
        this.leftSensor = null;
        this.rightSensor = null;
        this.pid = null;
    }

    start() {
        console.log('Mode: LINE');

        const lineSensor = require('@amperka/analog-line-sensor');
        const pidLib = require('@amperka/pid');

        this.leftSensor = lineSensor.connect(A0);
        this.rightSensor = lineSensor.connect(A1);
        this.pid = pidLib.create({
            target: 0,
            kp: 0.35,
            ki: 0.05,
            kd: 1.5,
            outputMin: -1.5,
            outputMax: 1.5
        });

        this.timer = setInterval(() => {
            if (!this.controller.state.on) return;
            const left = this.leftSensor.read();
            const right = this.rightSensor.read();
            const error = left - right;
            const output = this.pid.update(error);
            this.controller.movement.set(
                this.controller.state.speed + output,
                this.controller.state.speed - output
            );
        }, 20);
    }

    stop() {
        clearInterval(this.timer);
        this.controller.movement.stop();
        this.leftSensor = null;
        this.rightSensor = null;
        this.pid = null;
    }
}

class RobotController {
    constructor() {
        this.state = {
            on: true,
            projectorOn: false,
            speed: 0.7
        };
        this.head = new HeadController();
        this.modes = {
            MANUAL: new ManualMode(this),
            AUTO: new AutoMode(this),
            LINE: new LineMode(this),
            HOLD: new HoldMode(this)
        };
        this.movementType = 'ROBOT';
        this.movement = new RobotMovementControl();
        this.currentMode = this.modes.MANUAL;
        this.receiverLastTime = 0;
        receiver.on('receive', this.handleIR.bind(this));
    }

    switchMode(modeName) {
        if (this.currentMode) {
            this.currentMode.stop();
        }
        this.currentMode = this.modes[modeName];
        this.currentMode.start();
    }

    handleIR(code) {
        const now = getTime() * 1000;
        if (now - this.receiverLastTime <= 250) {
            return;
        }
        this.receiverLastTime = now;
        projector.blink(0.3);

        if (code === receiver.keys.CROSS) {
            this.head.toggle();
            return;
        }

        this.head.move(code);

        switch (code) {
            case receiver.keys.POWER:
                this.state.on = !this.state.on;
                if (!this.state.on) {
                    this.movement.stop();
                    projector.turnOff();
                }
                break;
            case receiver.keys.MINUS:
                this.state.speed = Math.max(0, this.state.speed - 0.1);
                break;
            case receiver.keys.PLUS:
                this.state.speed = Math.min(1, this.state.speed + 0.1);
                break;
            case receiver.keys.RED:
                this.switchMode('MANUAL');
                break;
            case receiver.keys.GREEN:
                this.switchMode('AUTO');
                break;
            case receiver.keys.BLUE:
                this.switchMode('LINE');
                break;
            case receiver.keys.TRIANGLE :
                this.switchMode('HOLD');
                break;
            case receiver.keys.SQUARE:
                this.projectorOn = !this.projectorOn;
                if (this.projectorOn) {
                    projector.turnOn();
                } else {
                    projector.turnOff();
                }
                break;
            case receiver.keys.Y:
                this.movement.stop();
                this.movement.destroy();
                if (this.movementType === 'ROBOT') {
                    this.movement = new CruiseControl(P10, P11, 195);
                    this.movementType = 'CRUISE';
                } else {
                    this.movement = new RobotMovementControl();
                    this.movementType = 'ROBOT';
                }
                break;
            default:
                this.currentMode.handleIR(code);
                break;
        }
    }
}

const controller = new RobotController();
controller.switchMode("MANUAL");

