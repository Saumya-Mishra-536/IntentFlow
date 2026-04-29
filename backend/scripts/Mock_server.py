import http.server
import socketserver
import json

PORT = 5678

class MockAPIHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()

        response = {}
        if self.path.startswith('/webhook/page-keyword-and-traffic'):
            from urllib.parse import urlparse, parse_qs
            query = parse_qs(urlparse(self.path).query)
            domain = query.get('domain', ['example.com'])[0]
            response = [
                {"keyword": f"best {domain.split('.')[0]} tools", "volume": 8100, "traffic_percent": 34.2, "keyword_difficulty": 62, "position": 3},
                {"keyword": f"{domain.split('.')[0]} review", "volume": 4400, "traffic_percent": 18.6, "keyword_difficulty": 45, "position": 7},
                {"keyword": f"{domain.split('.')[0]} pricing", "volume": 2900, "traffic_percent": 12.1, "keyword_difficulty": 38, "position": 5},
                {"keyword": f"{domain.split('.')[0]} alternative", "volume": 1800, "traffic_percent": 7.6, "keyword_difficulty": 55, "position": 12},
                {"keyword": f"{domain.split('.')[0]} tutorial", "volume": 1200, "traffic_percent": 5.1, "keyword_difficulty": 29, "position": 9},
            ]
        elif self.path.startswith('/webhook/ahrefs-domain-keywords'):
            response = [
                {"keyword": "seo software comparison", "volume": 5400, "traffic_percent": 28.0, "keyword_difficulty": 58},
                {"keyword": "keyword research tool", "volume": 3300, "traffic_percent": 17.1, "keyword_difficulty": 71},
                {"keyword": "backlink checker", "volume": 2100, "traffic_percent": 10.9, "keyword_difficulty": 63},
            ]
        else:
            response = {"status": "error", "message": "Endpoint not found"}

        self.wfile.write(json.dumps(response).encode('utf-8'))

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"status": "running", "message": "Mock Server is active"}).encode('utf-8'))

with socketserver.TCPServer(("", PORT), MockAPIHandler) as httpd:
    print(f"Mock server running on port {PORT}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down mock server.")
        httpd.server_close()