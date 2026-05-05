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
        if self.path == '/webhook/page-keyword-and-traffic':
            response = {
                "status": "success",
                "message": "Mocked SEMrush data",
                "data": {
                    "keywords": ["seo", "marketing", "auto"],
                    "traffic": 15000
                }
            }
        elif self.path == '/webhook/ahrefs-domain-keywords':
            response = {
                "status": "success",
                "message": "Mocked Ahrefs data",
                "data": {
                    "domainRating": 85,
                    "backlinks": 1200
                }
            }
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