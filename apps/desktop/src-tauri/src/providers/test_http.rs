//! Test-only local HTTP server shared by the remote adapter tests (std `TcpListener`, no
//! network). Each adapter's `tests.rs` adds its own `provider()` constructor on top.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    pub path: String,
    /// Lower-case header names.
    pub headers: HashMap<String, String>,
    /// The body as text (lossy for binary multipart parts).
    pub body: String,
}

#[derive(Clone)]
pub enum Reply {
    Json(u16, String),
    /// Wait before answering (client-timeout tests).
    Slow(Duration, u16, String),
}

pub struct MockServer {
    pub base_url: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

/// Longest the mock waits for the next connection before giving up on the remaining replies.
const ACCEPT_DEADLINE: Duration = Duration::from_secs(5);

impl MockServer {
    /// Serves `replies` in order, one connection each, under `http://127.0.0.1:<port><prefix>`.
    /// Stops when all replies are served, when no connection arrives within `ACCEPT_DEADLINE`,
    /// or when `requests()` / drop asks it to.
    pub fn start(prefix: &str, replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base_url = format!("http://{}{prefix}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (log, stop_flag) = (Arc::clone(&requests), Arc::clone(&stop));
        let handle = thread::spawn(move || {
            for reply in replies {
                let deadline = Instant::now() + ACCEPT_DEADLINE;
                let stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(e) if e.kind() == ErrorKind::WouldBlock => {
                            if stop_flag.load(Ordering::SeqCst) || Instant::now() > deadline {
                                return;
                            }
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => return,
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(ACCEPT_DEADLINE)).unwrap();
                serve_one(stream, &reply, &log);
            }
        });
        Self { base_url, requests, stop, handle: Some(handle) }
    }

    /// Requests served so far. Call after the adapter returned: every request it made has been
    /// answered by then, so unserved replies mean missing requests (the caller asserts the count).
    pub fn requests(&mut self) -> Vec<Recorded> {
        self.shutdown();
        self.requests.lock().unwrap().clone()
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// A port nothing listens on (connection refused at once).
pub fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn read_body(reader: &mut BufReader<TcpStream>, headers: &HashMap<String, String>) -> Option<Vec<u8>> {
    let chunked = headers.get("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked"));
    if !chunked {
        let length = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0usize);
        let mut body = vec![0; length];
        return reader.read_exact(&mut body).ok().map(|_| body);
    }
    let mut body = Vec::new();
    loop {
        let mut size_line = String::new();
        reader.read_line(&mut size_line).ok()?;
        let size = usize::from_str_radix(size_line.trim().split(';').next()?, 16).ok()?;
        let mut chunk = vec![0; size + 2]; // data + CRLF
        reader.read_exact(&mut chunk).ok()?;
        if size == 0 {
            return Some(body);
        }
        body.extend_from_slice(&chunk[..size]);
    }
}

fn serve_one(stream: TcpStream, reply: &Reply, log: &Mutex<Vec<Recorded>>) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return; // connection opened and closed without a request
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let Some(raw) = read_body(&mut reader, &headers) else {
        return;
    };
    let body = String::from_utf8_lossy(&raw).into_owned();
    log.lock().unwrap().push(Recorded { method, path, headers, body });

    let (status, payload) = match reply {
        Reply::Json(status, payload) => (*status, payload),
        Reply::Slow(delay, status, payload) => {
            thread::sleep(*delay);
            (*status, payload)
        }
    };
    let response = format!(
        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let mut stream = stream;
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}
