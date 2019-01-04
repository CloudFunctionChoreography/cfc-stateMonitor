'use strict';

const StepFunction = require("./entities/workflow/function/stepFunction");
const Instance = require("./entities/workflow/function/instance");
const Workflow = require("./entities/workflow/workflow");
const StepExecution = require("./entities/stepExecution");
const WorkflowExecution = require("./entities/workflowExecution");
const Sntp = require('sntp');
let offset = 0;
const fs = require('fs');
const openwhisk = require('openwhisk');
const ow = openwhisk({
    apihost: 'openwhisk.eu-gb.bluemix.net',
    namespace: 'simon.buchholz@campus.tu-berlin.de_dev',
    api_key: '735bf87f-b685-4dad-a705-b6e48e006cb3:FSRxx0LxHC0ibdttIylmH2O20R5TIaIi3FVnm6uej2aiYO8y8APMelNYcbuh88OC'
});
let openWhiskRequestsPerSecond = 0; // How many requests to the openwhisk API are waiting for a response?

class StateManager {
    constructor() {
        this.functions = [];
        this.workflows = [];
        this.pendingStepExecutions = [];
        this.finishedStepExecutions = [];
        this.pendingWorkflowExecutions = [];
        this.finishedWorkflowExecutions = [];
        this.startMetrics = [];
        this.endMetrics = [];

        this.initializeWorkflows();
    }

    initializeWorkflows() {
        fs.readFile('./assets/workflows.json', 'utf8', (err, data) => {
            if (err) {
                console.error(err);
            } else {
                let parsedWorkflows = JSON.parse(data).workflows;
                for (let workflow of parsedWorkflows) {
                    let newWorkflow = new Workflow(workflow);
                    let steps = workflow.workflow;
                    for (let stepName in steps) {
                        let stepFunction = this.getFunction(steps[stepName].functionEndpoint.functionName);
                        if (stepFunction === null) {
                            // function already exists
                            let functionName = steps[stepName].functionEndpoint.functionName;
                            let provider = steps[stepName].provider;
                            let endpoint = steps[stepName].functionEndpoint;
                            stepFunction = new StepFunction(functionName, provider, endpoint);
                        }
                        stepFunction.addStepName(stepName);
                        // stepFunction.addAssignedWorkflows(newWorkflow)
                        newWorkflow.addFunction(stepFunction);
                        this.functions.push(stepFunction);
                    }
                    this.workflows.push(newWorkflow);
                }

                // Periodically check for orphaned step or workflow executions and set them as finished
                setInterval(() => {
                    this.pendingStepExecutions.forEach(stepExecution => {
                        let functionExecutionLimit = 5000; // TODO set this limit according to FaaS function config
                        if (new Date().getTime() + offset - stepExecution.startTime > functionExecutionLimit) {
                            this.markExecutionFinished(stepExecution.stepExecutionUuid, false);
                        }
                    });
                }, 400);
            }
        });
    }

    getWorkflow(workflowName) {
        let result = null;
        for (let workflow of this.workflows) {
            if (workflow.name === workflowName) {
                result = workflow;
                break;
            }
        }
        return result;
    }

    /**
     *
     * @param functionName Can be either the function name or the step name in the workflows.
     * @returns {*}
     */
    getFunction(functionName) {
        let result = null;
        for (let stepFunction of this.functions) {
            if (stepFunction.name === functionName) {
                result = stepFunction;
                break;
            }
            if (stepFunction.stepNames.indexOf(functionName) > -1) {
                result = stepFunction;
                break;
            }
        }
        return result;
    }

    toString() {
        let result = `Workflows (${this.workflows.length}):\n`;
        this.workflows.forEach(workflow => {
            result = result + workflow.toString() + "\n";
        });
        result = result + `Functions (${this.functions.length}):` + "\n";
        this.functions.forEach(stepFunction => {
            result = result + stepFunction.toString() + "\n";
        });

        result = result + `finishedStepExecutions (${this.finishedStepExecutions.length})` + "\n";

        result = result + `pendingStepExecutions (${this.pendingStepExecutions.length}):` + "\n";
        this.pendingStepExecutions.forEach(pendingExecution => {
            result = result + pendingExecution.toString() + "\n";
        });
        return result;
    }

    getAverageMetrics(coldExecution, functionName) {
        let functionAvgMetrics = this.getFunction(functionName).getMetricsAvg(coldExecution);
        return functionAvgMetrics;
    }

    getWorkflowExecution(workflowUuid) {
        let workflowExecution = null;
        this.pendingWorkflowExecutions.forEach(iteratedWorkflowExecution => {
            if (iteratedWorkflowExecution.workflowExecutionUuid === workflowUuid) workflowExecution = iteratedWorkflowExecution;
        });
        if (workflowExecution === null) {
            this.finishedWorkflowExecutions.forEach(iteratedWorkflowExecution => {
                if (iteratedWorkflowExecution.workflowExecutionUuid === workflowUuid) workflowExecution = iteratedWorkflowExecution;
            });
        }
        return workflowExecution;
    }

    addStepExecution(workflowName, stepName, workflowExecutionUuid, stepExecutionUuid, instanceUuid, coldExecution, startTime, timeMetrics, simulation = false) {

        let workflow = this.getWorkflow(workflowName);
        let functionName = workflow.workflow.workflow[stepName].functionEndpoint.functionName;
        let stepFunction = this.getFunction(functionName);
        let newStepExecution = new StepExecution(workflowName, functionName, workflowExecutionUuid, stepExecutionUuid, instanceUuid, coldExecution, startTime, stepName);

        // if timeMetrics contain end Time, we calculate duration metrics and store them
        if (timeMetrics && !simulation) {
            if (timeMetrics.endTime !== null) {
                this.endMetrics.push(timeMetrics.endTime);

                let startMetric = null;
                for (let metric of this.startMetrics) {
                    if (metric.functionExecutionId === timeMetrics.endTime.functionExecutionId) {
                        startMetric = metric;
                        break;
                    }
                }

                if (startMetric) {
                    let previousMetric = null;
                    let previousMetricIndex = -1;
                    if (workflow.workflow.startAt === startMetric.stepName) {
                        // metric belongs to function 1 in workflow (it has no previous metric)
                        previousMetric = startMetric;
                    } else {
                        for (let i = 0; i < this.startMetrics.length; i++) {
                            let metric = this.startMetrics[i];
                            if (metric.workflowExecutionUuid === startMetric.workflowExecutionUuid && metric.startTime < startMetric.startTime && previousMetric === null) {
                                previousMetric = metric;
                                previousMetricIndex = i;
                            } else if (metric.workflowExecutionUuid === startMetric.workflowExecutionUuid && metric.startTime < startMetric.startTime && previousMetric.startTime < metric.startTime) {
                                previousMetric = metric;
                                previousMetricIndex = i;
                            }
                        }
                    }
                    if (previousMetric !== null) {
                        delete previousMetric.endTime;
                        this.startMetrics.splice(previousMetricIndex, 1);
                        for (let j = 0; j < this.endMetrics.length; j++) {
                            let endMetric = this.endMetrics[j];
                            if (endMetric.functionExecutionId === previousMetric.functionExecutionId) {
                                previousMetric.endTime = endMetric;
                                this.endMetrics.splice(j, 1);
                                break;
                            }
                        }
                    }

                    if (previousMetric && previousMetric.endTime) {
                        if (workflow.workflow.workflow[stepName].provider === "aws") {
                            let initDuration = startMetric.executionTimeLimit - startMetric.remainingTimeAtStart;
                            let executionDuration = timeMetrics.endTime.endTime - startMetric.startTime;
                            let executionOffset = workflow.workflow.startAt === startMetric.stepName ? 0 : startMetric.startTime - initDuration - previousMetric.endTime.endTime;
                            let cold = startMetric.coldExecution;
                            stepFunction.addMetric(startMetric.functionExecutionId, cold, initDuration, executionDuration, executionOffset, startMetric.startTime);
                        } else if (workflow.workflow.workflow[stepName].provider === "openWhisk") {
                            const getOpenWhiskMetrics = () => {
                                ow.activations.get({
                                    activationId: startMetric.functionExecutionId
                                }).then(result => {
                                    openWhiskRequestsPerSecond--;
                                    if (openWhiskRequestsPerSecond < 0) openWhiskRequestsPerSecond = 0;
                                    let initDuration = 0;
                                    result.annotations.forEach(annotation => {
                                        if (annotation.key === "waitTime") initDuration += annotation.value;
                                        if (annotation.key === "initTime") initDuration += annotation.value;
                                    });
                                    let executionDuration = timeMetrics.endTime.endTime - startMetric.startTime; // same as result.duration
                                    // console.log(`${startMetric.functionExecutionId} Execution duration ${executionDuration}, initDuration ${initDuration}`);
                                    let executionOffset = workflow.workflow.startAt === startMetric.stepName ? 0 : startMetric.startTime - initDuration - previousMetric.endTime.endTime;
                                    let cold = startMetric.coldExecution;
                                    stepFunction.addMetric(timeMetrics.endTime.functionExecutionId, cold, initDuration, executionDuration, executionOffset, startMetric.startTime);
                                }).catch(error => {
                                    openWhiskRequestsPerSecond--;
                                    if (openWhiskRequestsPerSecond < 0) openWhiskRequestsPerSecond = 0;
                                    console.warn("Could not get OpenWhisk metrics from API");
                                });
                            };
                            if (openWhiskRequestsPerSecond < 1) {
                                // if (openWhiskRequestsPerSecond < 2 || startMetric.coldExecution) { // we allow 2 open connections to openWhisk. Oherwise the API will refuse
                                getOpenWhiskMetrics(); // TODO implement throttling
                                openWhiskRequestsPerSecond++;
                            }
                        }
                    }
                }
            }
            // TODO clean startMetrics and endMetrics: at the moment it is append only and therefore growing with each execution
            /* if(this.startMetrics.length > 1500) {
                this.startMetrics.sort((a, b) => {
                    if (a.timeMetrics.startTime < b.timeMetrics.startTime) {
                        return -1;
                    }
                    if (a.timeMetrics.startTime > b.timeMetrics.startTime) {
                        return 1;
                    }
                    // a muss gleich b sein
                    return 0;
                });
                this.startMetrics.splice(0, 200);
            } */
            this.startMetrics.push(Object.assign({
                functionExecutionId: stepExecutionUuid,
                coldExecution,
                stepName,
                workflowExecutionUuid
            }, timeMetrics));
        }

        let functionInstance = stepFunction.getInstance(instanceUuid);
        if (functionInstance === null) {
            // in the case of cold start or a function already existed before server started
            functionInstance = new Instance(instanceUuid);
            stepFunction.addInstance(functionInstance);
        }
        functionInstance.setStateBusy();

        // change state of the execution to finished when the average execution time has passed
        if (!simulation) {
            Sntp.offset((err, timeOffset) => {
                if (err) {
                    throw err;
                } else {
                    offset = timeOffset;
                    let functionAvgMetrics = this.getFunction(newStepExecution.functionName).getMetricsAvg(coldExecution);
                    // console.log(`Average ${coldExecution ? "cold" : "warm"} function durations: ${JSON.stringify(functionAvgMetrics)}`);
                    if (functionAvgMetrics !== null) {
                        let now = new Date().getTime() + timeOffset;
                        let probableEndTime = startTime + functionAvgMetrics.executionDuration;
                        let remainingExecutionTime = probableEndTime - now;
                        setTimeout(() => {
                            this.markExecutionFinished(newStepExecution.stepExecutionUuid, simulation);
                        }, remainingExecutionTime);
                        // console.log(`Remaining execution for step ${stepName}: ${remainingExecutionTime}`)
                    }
                }
            });
        }

        // check if any old step function executions of the same workflow execution is
        // in "pending" state and change it to "finished" state (happens if execution was much faster as average execution for the function)
        this.markExecutionFinished(newStepExecution.workflowExecutionUuid, simulation);

        this.pendingStepExecutions.push(newStepExecution);
        let newWorkflowExecution = this.getWorkflowExecution(workflowExecutionUuid);
        if (newWorkflowExecution === null) {
            newWorkflowExecution = new WorkflowExecution(workflowExecutionUuid, workflow, newStepExecution);
            workflow.addWorkflowExecution(newWorkflowExecution);
            this.pendingWorkflowExecutions.push(newWorkflowExecution);
            // console.log(`${workflow.getArrivalRate(10000) * 1000} workflow executions arrive per seconds`);
        } else {
            newWorkflowExecution.addStepExecution(newStepExecution);
        }
    }

    /**
     *
     * @param executionUuid Either the stepExecutionUuid or the workflowExecutionUuid
     */
    markExecutionFinished(executionUuid, simulation) {
        let index = -1;
        for (let i = 0; i < this.pendingStepExecutions.length; i++) {
            if (this.pendingStepExecutions[i].stepExecutionUuid === executionUuid || this.pendingStepExecutions[i].workflowExecutionUuid === executionUuid) {
                index = i;
                break;
            }
        }
        if (index > -1) {
            let pendingExecution = this.pendingStepExecutions[index];
            this.pendingStepExecutions.splice(index, 1);
            pendingExecution.setStateDone();
            this.getFunction(pendingExecution.functionName).getInstance(pendingExecution.instanceUuid).setStateIdle();
            this.finishedStepExecutions.push(pendingExecution);

            // if execution was last in workflow: mark workflow-execution as finished too:
            let workflow = this.getWorkflow(pendingExecution.workflowName);
            for (let stepName in workflow.workflow.workflow) {
                let step = workflow.workflow.workflow[stepName];
                if ((step.end === true || step.end === "true") && this.getFunction(pendingExecution.functionName).isStep(stepName)) {
                    let workflowExecution = this.getWorkflowExecution(pendingExecution.workflowExecutionUuid);
                    let index = -1;
                    for (let i = 0; i < this.pendingWorkflowExecutions.length; i++) {
                        if (this.pendingWorkflowExecutions[i].workflowExecutionUuid === workflowExecution.workflowExecutionUuid) {
                            index = i;
                            break;
                        }
                    }
                    if (index > -1) {
                        this.finishedWorkflowExecutions.push(this.pendingWorkflowExecutions[index]);
                        this.pendingWorkflowExecutions.splice(index, 1);
                        break;
                    }
                }
            }
        }

        // remove some finished workflow executions if the array gets too big
        if (this.finishedWorkflowExecutions.length > 150 && !simulation) {
            this.finishedWorkflowExecutions.sort((a, b) => {
                if (a.startTime < b.startTime) return -1;
                if (a.startTime > b.startTime) return 1;
                return 0;
            });
            this.finishedWorkflowExecutions.splice(0, 50);
            // console.log(`removing 50 finished workflows for performance improvement`)
        }
        if (this.finishedStepExecutions.length > 700 && !simulation) {
            this.finishedStepExecutions.sort((a, b) => {
                if (a.startTime < b.startTime) return -1;
                if (a.startTime > b.startTime) return 1;
                return 0;
            });
            this.finishedStepExecutions.splice(0, 200);
            // console.log(`removing 200 finished steps for performance improvement`)
        }
    }
}

module.exports = StateManager;