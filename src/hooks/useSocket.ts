import { useState, useEffect } from 'react';

export function useSocket() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const res = await fetch('/api/status', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        setStatus(data);
      } catch (e) {
        console.error(e);
      }
    };

    fetchStatus();
    // In a real app with Socket.io client, we would listen for 'stream_status' events here
  }, []);

  return { status, setStatus };
}
