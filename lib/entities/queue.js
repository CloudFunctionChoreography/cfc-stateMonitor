const StepExecution = require("./stepExecution");

class Queue {

    constructor(data) {
        this.tasksArray = data ? data : [];
    }

    add(record) {
        this.tasksArray.unshift(record);
    }

    remove() {
        this.tasksArray.pop();
    }

    first() {
        return this.tasksArray[0];
    }

    last() {
        return this.tasksArray[this.data.length - 1];
    }

    size() {
        return this.tasksArray.length;
    }
}

module.exports = Queue;