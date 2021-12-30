
const { encode, serialize, deserialize } = require('shared/util/encoder');

class Messenger {

    constructor() {

        this.defaultDict = [
            'room_slug',
            'game_slug',
            'state',
            'events',
            'players',
            'timer',
            'next',
            'prev',
            'action',
            'seq',
            'rank',
            'rating',
            'score',
            '_win',
            '_loss',
            '_tie',
            '_played'
        ]


    }



    send = (ws, message) => {
        ws.send(message, true, false);
    }

    publish = (app, route, message) => {

        app.publish(room_slug, encoded, true, false)

    }

}

module.exports = new Messenger();