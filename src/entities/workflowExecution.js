
class WorkflowExecution {
    constructor(workflowExecutionUuid, workflow, firstStepExecution = null) {
        this.workflowExecutionUuid = workflowExecutionUuid;
        this.workflow = workflow;
        this.stepExecutions = [];
        this.currentStepExecution = null;
        this.firstStepExecution = null;
        this.startTime = null;
        if (firstStepExecution) {
            this.firstStepExecution = firstStepExecution;
            this.addStepExecution(firstStepExecution);
            this.startTime = firstStepExecution.startTime;
        }
    }

    addStepExecution(stepExecution) {
        this.currentStepExecution = stepExecution;
        this.stepExecutions.push(stepExecution);
    }

    toString() {
        const stringStepExecutions = [];
        this.stepExecutions.forEach(value => {
            stringStepExecutions.push(value.toString());
        });
        return JSON.stringify({ workflowExecutionUuid: this.workflowExecutionUuid, stepExecutions: stringStepExecutions });
    }
}

module.exports = WorkflowExecution;