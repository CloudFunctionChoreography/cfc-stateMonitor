const StateEnum = {
    BUSY: 1,
    IDLE: 2
};

class Instance {

    constructor(instanceUuid) {
        this.instanceUuid = instanceUuid;
        this.state = StateEnum.IDLE;
    }

    setStateBusy() {
        this.state = StateEnum.BUSY;
    }

    setStateIdle() {
        this.state = StateEnum.IDLE;
    }

    toString() {
        return JSON.stringify(this);
    }
}

module.exports = Instance;