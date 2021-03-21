const { w3cwebsocket } = require("websocket");
const credutil = require('fsg-shared/util/credentials');

class WSClient {
    constructor(credentials) {
        this.credentials = credentials || credutil();
    }

    async connect(addr, apikey, { cbOpen, cbError, cbMessage, cbClose }) {

        this.client = new w3cwebsocket(`ws://${addr}/`, apikey, '*', {});

        this.cbOpen = cbOpen || null;
        this.cbError = cbError || null;
        this.cbMessage = cbMessage || null;
        this.cbClose = cbClose || null;

        this.client.onopen = this.onOpen.bind(this);
        this.client.onerror = this.onError.bind(this);
        this.client.onmessage = this.onMessage.bind(this);
        this.client.onclose = this.onClose.bind(this);
    }

    async onClose(event) {
        if (this.cbClose) {
            this.cbClose(this.client, event);
        }
    }
    async onOpen(event) {

        if (this.cbOpen) {
            this.cbOpen(this.client, event);
        }
        console.log(event);
        console.log('WSClient Connected to Cluster');

        if (this.client.readyState == this.client.OPEN) {

        }
    }

    async onError(error) {
        if (this.cbError) {
            this.cbError(this.client, error);
        }
        console.error(error);
    }

    async onMessage(message) {
        if (this.cbMessage) {
            this.cbMessage(this.client, message);
        }

        // let buffer = await message.data.arrayBuffer();
        // let msg = decode(buffer);
        // console.log(msg);
    }
}

module.exports = new WSClient();