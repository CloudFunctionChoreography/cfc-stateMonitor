const Workflow = require("../workflow");

class StepFunction {

    constructor(functionName, provider, endpoint) {
        this.name = functionName;
        this.provider = provider;
        this.endpoint = endpoint;
        this.warmInstances = [];
        this.removedInstances = [];
        // this.assignedWorkflows = [];
        this.metrics = [];
        this.stepNames = [];
        this.warmMetricsAvg = null;
        this.coldMetricsAvg = null;
    }

    addStepName(stepName) {
        this.stepNames.push(stepName);
    }

    isStep(stepName) {
        let result = false;
        this.stepNames.forEach(value => {
            if (value === stepName) result = true;
        });
        return result;
    }

    getIdleInstances() {
        let idleInstances = [];
        this.warmInstances.forEach(instance => {
            if (instance.state === 2) {
                idleInstances.push(instance);
            }
        });
        return idleInstances;
    }

    toString() {
        let warmInstancesStr = [];
        this.warmInstances.forEach(instance => {
            warmInstancesStr.push(instance.instanceUuid);
        });
        /* let assignedWorkflowsStr = [];
        this.assignedWorkflows.forEach(workflow => {
            assignedWorkflowsStr.push(workflow.name)
        }); */
        return JSON.stringify({
            name: this.name,
            provider: this.provider,
            // assignedWorkflows: assignedWorkflowsStr,
            averageMetricsCold: this.getMetricsAvg(true),
            averageMetricsWarm: this.getMetricsAvg(false),
            warmInstances: warmInstancesStr
        });
    }

    /* addAssignedWorkflows(workflow: Workflow) {
        this.assignedWorkflows.push(workflow)
    } */

    addMetric(functionExecutionId, coldExecution, initDuration, executionDuration, executionOffset, stepStartTime) {
        this.metrics.push({
            functionExecutionId: functionExecutionId,
            coldExecution: coldExecution,
            initDuration: initDuration,
            executionDuration: executionDuration,
            executionOffset: executionOffset,
            stepStartTime: stepStartTime
        });
        this.calculateMetricsAvg(coldExecution);
    }

    calculateMetricsAvg(coldExecution) {
        let avgInitDuration = 0;
        let avgExecutionDuration = 0;
        let avgNetworkLatency = 0;
        let numberOfMetrics = 0;
        this.metrics.sort((a, b) => {
            if (a.stepStartTime < b.stepStartTime) return -1;
            if (a.stepStartTime > b.stepStartTime) return 1;
            return 0;
        });

        // if array gets to full, we remove some metrics for better performance
        if (this.metrics.length > 120) {
            let remainingMetricsArray = [];
            for (let i = 0; i < this.metrics.length; i++) {
                if (this.metrics[i].coldExecution || i > 50) {
                    // TODO not a good condition. could fill up only with cold metrics
                    remainingMetricsArray.push(this.metrics[i]);
                }
            }
            this.metrics = remainingMetricsArray;
        }

        for (let i = 0; i < this.metrics.length; i++) {
            if (this.metrics[i].coldExecution === coldExecution) {
                numberOfMetrics++;
                avgInitDuration = avgInitDuration + this.metrics[i].initDuration;
                avgExecutionDuration = avgExecutionDuration + this.metrics[i].executionDuration;
                avgNetworkLatency = avgNetworkLatency + this.metrics[i].executionOffset;
            }
        }

        avgInitDuration = avgInitDuration / numberOfMetrics;
        avgExecutionDuration = avgExecutionDuration / numberOfMetrics;
        avgNetworkLatency = avgNetworkLatency / numberOfMetrics;
        let avgMetrics;
        if (numberOfMetrics === 0) {
            avgMetrics = null;
        } else {
            avgMetrics = {
                executionOffset: avgNetworkLatency,
                initDuration: avgInitDuration,
                executionDuration: avgExecutionDuration
            };
        }
        if (coldExecution) {
            this.coldMetricsAvg = avgMetrics;
        } else {
            this.warmMetricsAvg = avgMetrics;
        }
        // console.log(`(${numberOfMetrics}) ${this.name} ${coldExecution}: ${JSON.stringify(avgMetrics)}`);
        return avgMetrics;
    }

    getMetricsAvg(coldExecution) {
        if (coldExecution) {
            return this.coldMetricsAvg;
        } else {
            return this.warmMetricsAvg;
        }
    }

    addInstance(instance) {
        this.warmInstances.push(instance);
        return instance;
    }

    removeInstance(instance) {
        // TODO not tested yet
        const arrayIndex = this.warmInstances.indexOf(instance);
        this.removedInstances.push(this.warmInstances[arrayIndex]);
        this.warmInstances.splice(arrayIndex, 1);
        return instance;
    }

    getInstance(uuid) {
        let result = null;
        for (let instance of this.warmInstances) {
            if (instance.instanceUuid === uuid) {
                result = instance;
                break;
            }
        }
        if (result === null) {
            for (let instance of this.removedInstances) {
                if (instance.instanceUuid === uuid) {
                    result = instance;
                    break;
                }
            }
        }
        return result;
    }

    getPendingStepExecutions() {
        // TODO not tested yet

        let result = [];
        for (let instance of this.warmInstances) {
            instance.pendingStepExecutions.forEach(stepExecution => {
                result.push(stepExecution);
            });
        }
        return result;
    }

    getFinishedStepExecutions() {
        // TODO not tested yet

        let result = [];
        for (let instance of this.warmInstances) {
            instance.pendingStepExecutions.forEach(stepExecution => {
                result.push(stepExecution);
            });
        }
        for (let instance of this.removedInstances) {
            instance.pendingStepExecutions.forEach(stepExecution => {
                result.push(stepExecution);
            });
        }
        return result;
    }
}

module.exports = StepFunction;