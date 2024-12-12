export let ws = null;

export function initializeWebSocket() {
    function connect() {
        ws = new WebSocket('ws://localhost:8080/ws');

        ws.onopen = () => {
            console.log('Connected to backend');
        };

        ws.onclose = () => {
            console.log('Connection closed. Retrying in 5 seconds...');
            setTimeout(connect, 5000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    connect();
}