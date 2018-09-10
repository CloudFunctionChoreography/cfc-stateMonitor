class Instance {

    constructor(initTime, coldStartDuration, uuid) {
        this.initTime = initTime;
        this.coldStartDuration = coldStartDuration;
        this.pendingStepExecutions = [];
        this.finishedStepExecutions = [];
        this.uuid = uuid;
    }
}

module.exports = Instance;