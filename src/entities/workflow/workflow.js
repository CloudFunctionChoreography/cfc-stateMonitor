const StepFunction = require("./function/stepFunction");
const Sntp = require('sntp');

class Workflow {
    constructor(workflow) {
        this.name = workflow.name;
        this.workflow = workflow;
        // this.workflowExecutions = [];
        this.functions = [];
        this.workflowStartTimes = [];
        this.offset = 0;
        this.arrivalRate = 0;

        Sntp.offset((err, timeOffset) => {
            if (err) {
                console.error(`Could not synchronize time ${err}`);
            } else {
                this.offset = timeOffset;
            }
        });

        // periodically update arrival rate (in case no new workflow executions arrive)
        setInterval(() => {
            this.arrivalRate = this.getArrivalRate();
        }, 5000);
    }

    addFunction(stepFunction) {
        this.functions.push(stepFunction);
    }

    addWorkflowExecution(workflowExecution) {
        if (workflowExecution.firstStepExecution && workflowExecution.firstStepExecution.startTime) this.workflowStartTimes.push(workflowExecution.firstStepExecution.startTime);
        this.workflowStartTimes.sort((a, b) => {
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        });
        this.arrivalRate = this.getArrivalRate();
        if (this.workflowStartTimes.length > 1000) this.workflowStartTimes.splice(0, 100); // throw away old workflowStartTimes to avoid stackoverflow
        // this.workflowExecutions.push(workflowExecution)
    }

    /**
     * Arrival rate per second
     * @param numOfPoints How many of the last workflow executions will be included in calculation (default 30)
     * @returns {number}
     */
    getArrivalRate(numOfPoints) {
        const workflowStartTimes = [...this.workflowStartTimes];
        let arrivalRate = 0.0;
        if (workflowStartTimes.length >= 30) {
            let startTimes = [];

            let i = 30;
            let min = workflowStartTimes[workflowStartTimes.length - 1];
            let max = workflowStartTimes[workflowStartTimes.length - 1];
            while (i > 1) {
                min = Math.min(min, workflowStartTimes[workflowStartTimes.length - i]);
                max = Math.max(max, workflowStartTimes[workflowStartTimes.length - i]);
                startTimes.push(workflowStartTimes[workflowStartTimes.length - i]);
                i--;
            }
            let interval = max - min;
            if (startTimes.length > 0) arrivalRate = startTimes.length * 1.0 / interval;
            let lastTime = workflowStartTimes[workflowStartTimes.length - 1];
            if (lastTime < new Date().getTime() + this.offset - 10000.0) {
                arrivalRate = 0;
            }
        }
        return arrivalRate * 1000.0;
    }

    toString() {
        let functions = "";
        this.functions.forEach(stepFunction => {
            functions = functions + stepFunction.name + ", ";
        });
        functions = functions.substring(0, functions.length - 2); // "12345.0"

        return `Workflow name: ${this.name},\nFunctions: [${functions}]`;
    }
}

module.exports = Workflow;