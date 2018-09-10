class Function {

    constructor(functionName, provider, stepName, endpoint) {
        this.functionName = name;
        this.provider = provider;
        this.stepName = stepName;
        this.endpoint = endpoint;
        this.queue = new Queue();
        this.warmInstances = [];
        this.removedInstances = [];
        this.coldStartDurations = [];
    }

    addInstance(instance) {
        this.coldStartDurations.push({ timestamp: instance.initTime, duration: instance.coldStartDuration });
        this.warmInstances.push(instance);
        return instance;
    }

    removeInstance(instance) {
        const arrayIndex = this.warmInstances.indexOf(instance);
        this.removedInstances.push(this.warmInstances[arrayIndex]);
        delete this.warmInstances[arrayIndex];
        return instance;
    }

    getInstance(uuid) {
        let result = null;
        for (let instance of this.warmInstances) {
            if (instance.uuid === uuid) {
                result = instance;
                break;
            }
        }
        if (result === null) {
            for (let instance of this.removedInstances) {
                if (instance.uuid === uuid) {
                    result = instance;
                    break;
                }
            }
        }
        return result;
    }

    getPendingStepExecutions() {
        let result = [];
        for (let instance of this.warmInstances) {
            instance.pendingStepExecutions.forEach(stepExecution => {
                result.push(stepExecution);
            });
        }
        return result;
    }

    getFinishedStepExecutions() {
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

module.exports = Function;