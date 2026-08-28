import { WebSocket, WebSocketServer } from "ws";

export interface EchoServer {
    readonly port: number;
    close(): Promise<void>;
}

/**
 * Minimal demo server: every text frame is broadcast to every connected
 * client except the sender (excluding the sender keeps the demo's echo bot
 * from answering its own replies).
 */
export async function startEchoServer(port = 0): Promise<EchoServer> {
    const server = new WebSocketServer({ port });
    await new Promise<void>((resolve) => server.on("listening", resolve));

    server.on("connection", (socket) => {
        socket.on("message", (data) => {
            const text = Array.isArray(data)
                ? Buffer.concat(data).toString()
                : data instanceof ArrayBuffer
                  ? Buffer.from(data).toString()
                  : data.toString();
            for (const client of server.clients) {
                if (client !== socket && client.readyState === WebSocket.OPEN) {
                    client.send(text);
                }
            }
        });
    });

    const address = server.address();
    return {
        port: typeof address === "object" && address !== null ? address.port : port,
        close: () =>
            new Promise<void>((resolve, reject) => {
                // `close` waits for connected clients; terminate them first.
                for (const client of server.clients) client.terminate();
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}
