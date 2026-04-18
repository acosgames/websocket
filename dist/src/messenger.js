class Messenger {
    constructor() {
        this.send = (ws, message) => {
            ws.send(message, true, false);
        };
        this.publish = (app, room_slug, encoded) => {
            app.publish(room_slug, encoded, true, false);
        };
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
}
export default new Messenger();
//# sourceMappingURL=messenger.js.map