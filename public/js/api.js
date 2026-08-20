const API = {
  async get(url) {
    try {
      const res = await fetch(url);
      if (res.status === 401) {
        window.location.href = '/';
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error('API error:', e);
      return null;
    }
  },

  async post(url) {
    try {
      const res = await fetch(url, { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/';
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error('API error:', e);
      return null;
    }
  },

  getUser() { return this.get('/api/user'); },
  getLeaderboard() { return this.get('/api/leaderboard'); },
  getTransfers() { return this.get('/api/transfers'); },
  getGuildStats() { return this.get('/api/guild/stats'); },
  getShortcuts() { return this.get('/api/guild/shortcuts'); },
  claimDaily() { return this.post('/api/daily/claim'); },
};
