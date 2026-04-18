import { encode, serialize, deserialize } from 'acos-json-encoder';

class Messenger {
    defaultDict: string[];

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
        ];
    }

    send = (ws: any, message: any): void => {
        ws.send(message, true, false);
    }

    publish = (app: any, room_slug: string, encoded: any): void => {
        app.publish(room_slug, encoded, true, false);
    }
}

export default new Messenger();
