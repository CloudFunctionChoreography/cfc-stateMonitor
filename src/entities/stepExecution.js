const StateEnum = {
    PENDING: 1,
    DONE: 2
};

class StepExecution {
    constructor(workflowName, functionName, workflowUuid, stepExecutionUuid, instanceUuid,
                receiveTime, coldExecution) {
        this.workflowName = workflowName;
        this.functionName = functionName;
        this.workflowUuid = workflowUuid;
        this.stepExecutionUuid = stepExecutionUuid;
        this.instanceUuid = instanceUuid;
        this.receiveTime = receiveTime;
        this.coldExecution = coldExecution;
        this.state = StateEnum.PENDING;
    }

    setStatePending() {
        this.state = StateEnum.PENDING
    }

    setStateDone() {
        this.state = StateEnum.DONE
    }

    toString() {
        return JSON.stringify(this)
    }
}

module.exports = StepExecution;