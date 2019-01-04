const StateEnum = {
    PENDING: 1,
    DONE: 2
};

class StepExecution {
    constructor(workflowName, functionName, workflowExecutionUuid, stepExecutionUuid, instanceUuid, coldExecution, startTime, stepName) {
        this.workflowName = workflowName;
        this.functionName = functionName;
        this.workflowExecutionUuid = workflowExecutionUuid;
        this.stepExecutionUuid = stepExecutionUuid;
        this.instanceUuid = instanceUuid;
        this.coldExecution = !!(coldExecution && coldExecution.wasCold);
        this.state = StateEnum.PENDING;
        this.startTime = startTime;
        this.stepName = stepName;
    }

    setStatePending() {
        this.state = StateEnum.PENDING;
    }

    setStateDone() {
        this.state = StateEnum.DONE;
    }

    toString() {
        return JSON.stringify(this);
    }
}

module.exports = StepExecution;