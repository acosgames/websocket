

const PSON = require('pson');
const UWSjs = require('uWebSockets.js/uws');
const uws = UWSjs.App();
const pson = new PSON.ProgressivePair()


uws.ws('/*', {

    /* There are many common helper features */
    idleTimeout: 30,
    maxBackpressure: 1024,
    maxPayloadLength: 512,
    //compression: DEDICATED_COMPRESSOR_3KB,

    /* For brevity we skip the other events (upgrade, open, ping, pong, close) */
    message: (ws, message, isBinary) => {
        /* You can do app.publish('sensors/home/temperature', '22C') kind of pub/sub as well */

        /* Here we echo the message back, using compression if available */
        let ok = ws.send(message, isBinary, true);
    }

}).get('/*', (res, req) => {

    /* It does Http as well */
    console.log(req);

    let hookid = req.getHeader('x-github-hook-id');
    console.log("hookid", hookid);
    req.forEach((k, v) => {
        res.write('<li>');
        res.write(k);
        res.write(' = ');
        res.write(v);
        res.write('</li>');
    });
    res.end('</ul>');
    // res.writeStatus('200 OK').writeHeader('IsExample', 'Yes').end('Hello there!');

}).listen(9001, (listenSocket) => {

    if (listenSocket) {
        console.log('Listening to port 9001');

        let payload = { "hello": "world", status: 200 };
        let encoded = pson.encode(payload);
        console.log(encoded);
        let decoded = pson.decode(encoded);
        console.log(decoded);

        console.log("Mem: ", process.memoryUsage())
        const used = process.memoryUsage().heapUsed / 1024 / 1024;
        console.log(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
    }

});
