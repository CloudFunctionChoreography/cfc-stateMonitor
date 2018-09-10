//@flow
'use strict';

const StepFunction = require("./entities/workflow/function/stepFunction");
const Instance = require("./entities/workflow/function/instance");
const Workflow = require("./entities/workflow/workflow");
const StepExecution = require("./entities/stepExecution");


const fs = require('fs');

class StateManager {
    constructor() {
        this.functions = [];
        this.workflows = [];
        this.pendingExecutions = [];
        this.finishedExecutions = [];

        this.initializeWorkflows();
    }


    initializeWorkflows() {
        fs.readFile('./assets/workflows.json', 'utf8', (err, data) => {
                if (err) {
                    console.error(err)
                } else {
                    let parsedWorkflows = JSON.parse(data).workflows;
                    for (let workflow of parsedWorkflows) {
                        let newWorkflow = new Workflow(workflow);
                        let steps = workflow.workflow;
                        for (let stepName in steps) {
                            let stepFunction = this.getFunction(steps[stepName].functionEndpoint.functionName)
                            if (stepFunction === null) { // function already exists
                                let functionName = steps[stepName].functionEndpoint.functionName;
                                let provider = steps[stepName].provider;
                                let endpoint = steps[stepName].functionEndpoint;
                                stepFunction = new StepFunction(functionName, provider, endpoint)
                            }
                            stepFunction.addAssignedWorkflows(newWorkflow)
                            newWorkflow.addFunction(stepFunction)
                            this.functions.push(stepFunction)
                        }
                        this.workflows.push(newWorkflow);
                    }
                }
            }
        );
    }

    getWorkflow(workflowName: string): Workflow {
        let result = null
        for (let workflow of this.workflows) {
            if (workflow.name === workflowName) {
                result = workflow
                break
            }
        }
        return result
    }

    getFunction(functionName: string): StepFunction {
        let result = null
        for (let stepFunction of this.functions) {
            if (stepFunction.name === functionName) {
                result = stepFunction
                break
            }
        }
        return result
    }

    toString(): string {
        let result = `Workflows (${this.workflows.length}):\n`;
        this.workflows.forEach(workflow => {

            result = result + workflow.toString() + "\n"
        });
        result = result + `Functions (${this.functions.length}):` + "\n";
        this.functions.forEach(stepFunction => {
            result = result + stepFunction.toString() + "\n";
        });

        result = result + `FinishedExecutions (${this.finishedExecutions.length})` + "\n";

        result = result + `PendingExecutions (${this.pendingExecutions.length}):` + "\n";
        this.pendingExecutions.forEach(pendingExecution => {
            result = result + pendingExecution.toString() + "\n";
        });
        return result
    }


    addStepExecution(workflowName: string,
                     stepName: string,
                     workflowExecutionUuid,
                     stepExecutionUuid,
                     instanceUuid,
                     receiveTime,
                     lastMeasuredExecutionDuration,
                     lastNetworkLatencyToNextStep,
                     coldExecution ? = null) {
        let workflow = this.getWorkflow(workflowName);
        let functionName = workflow.workflow.workflow[stepName].functionEndpoint.functionName;
        let stepFunction = this.getFunction(functionName);
        let newStepExecution = new StepExecution(workflowName, functionName, workflowExecutionUuid, stepExecutionUuid, instanceUuid,
            receiveTime, coldExecution);


        if (coldExecution && coldExecution.wasCold) {
            stepFunction.addInitTimeMetric(coldExecution.initTime);
            // instance does not exist yet: add instance
            let newFunctionInstance = new Instance(coldExecution.initTime, instanceUuid);
            newFunctionInstance.setStateBusy();
            stepFunction.addInstance(newFunctionInstance);
        } else {
            stepFunction.addExecutionDurationMetric(lastMeasuredExecutionDuration);
            stepFunction.addNetworkLatencyMetric(lastNetworkLatencyToNextStep);
            let functionInstance = stepFunction.getInstance(instanceUuid);
            if (functionInstance === null) {// fallback: should not happen:
                functionInstance = new Instance(coldExecution.initTime, instanceUuid);
                stepFunction.addInstance(functionInstance);
            }
            functionInstance.setStateBusy();
        }

        this.pendingExecutions.forEach((pendingExecution, index) => {
            if (pendingExecution.workflowExecutionUuid === newStepExecution.workflowExecutionUuid) {
                pendingExecution.setStateDone();
                this.getFunction(pendingExecution.functionName).getInstance(pendingExecution.instanceUuid).setStateIdle();
                this.finishedExecutions.push(pendingExecution);
                this.pendingExecutions.splice(index, 1);
            }
        });
        this.pendingExecutions.push(newStepExecution);


        console.log(this.toString());


    }
}

module.exports = StateManager;