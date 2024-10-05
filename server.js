const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const upload = multer({ dest: 'uploads/' });
const db = new sqlite3.Database('vocabulary.db');

app.use(express.json());
app.use(express.static('public'));

// 添加错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// 初始化数据库和wordDatabase
let wordDatabase = [];

function loadWordDatabase() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM words", (err, rows) => {
      if (err) {
        reject(err);
      } else {
        wordDatabase = rows;
        resolve(rows);
      }
    });
  });
}

// 初始化数据库
db.serialize(() => {
//   db.run("DROP TABLE IF EXISTS error_bank");
  db.run("CREATE TABLE IF NOT EXISTS words (id INTEGER PRIMARY KEY, en TEXT, zh TEXT, is_root BOOLEAN)");
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE)");
  db.run("CREATE TABLE IF NOT EXISTS error_bank (user_id INTEGER, word_id INTEGER, error_count INTEGER DEFAULT 0, correct_count INTEGER DEFAULT 0, PRIMARY KEY (user_id, word_id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(word_id) REFERENCES words(id))");
  db.run("CREATE TABLE IF NOT EXISTS test_records (id INTEGER PRIMARY KEY, user_id INTEGER, score INTEGER, total_questions INTEGER, test_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))");
  
  // 检查 error_bank 表结构
  db.all("PRAGMA table_info(error_bank)", (err, rows) => {
    if (err) {
      console.error("Error checking error_bank table structure:", err);
    } else {
      const columns = rows.map(row => row.name);
      if (!columns.includes('correct_count')) {
        db.run("ALTER TABLE error_bank ADD COLUMN correct_count INTEGER DEFAULT 0", (err) => {
          if (err) {
            console.error("Error adding correct_count column:", err);
          } else {
            console.log("Added correct_count column to error_bank table");
          }
        });
      } else {
        console.log("correct_count column already exists in error_bank table");
      }
    }
  });

  // 加载wordDatabase
  loadWordDatabase().catch(console.error);
});

// 在其他路由之前添加这个新路由
app.post('/clear_database', (req, res) => {
  db.serialize(() => {
    db.run("DELETE FROM words", (err) => {
      if (err) {
        console.error("Error clearing words table:", err);
        res.status(500).json({ error: 'Failed to clear database' });
      } else {
        console.log("Words table cleared successfully");
        res.json({ message: 'Database cleared successfully' });
      }
    });
  });
});

// 添加根路由处理
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/import_words', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const results = [];
  fs.createReadStream(req.file.path, { encoding: 'utf-8' })
    .pipe(csv())
    .on('data', (data) => {
      // 处理第一列名称中的BOM字符
      const keys = Object.keys(data);
      if (keys[0].startsWith('\ufeff')) {
        const newKey = keys[0].slice(1);
        data[newKey] = data[keys[0]];
        delete data[keys[0]];
      }
      results.push(data);
    })
    .on('end', () => {
      console.log('Parsed CSV data:', results);

      if (results.length === 0) {
        return res.status(400).json({ error: 'No data found in the CSV file' });
      }

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("INSERT INTO words (en, zh, is_root) VALUES (?, ?, ?)");
        let insertedCount = 0;

        results.forEach((row, index) => {
          if (index === 0) return; // Skip header row
          
          const en = row.en ? row.en.trim() : null;
          const zh = row.zh ? row.zh.trim() : null;
          const isRoot = row.is_root ? row.is_root.trim().toUpperCase() === 'TRUE' : false;

          if (en && zh) {
            stmt.run(en, zh, isRoot ? 1 : 0, function(err) {
              if (err) {
                console.error("Error inserting row:", err, row);
              } else {
                insertedCount++;
                console.log("Inserted row:", [en, zh, isRoot]);
              }
            });
          } else {
            console.warn("Skipping invalid row:", row);
          }
        });

        stmt.finalize();
        db.run("COMMIT", (err) => {
          if (err) {
            console.error("Error committing transaction:", err);
            res.status(500).json({ error: 'Failed to import words' });
          } else {
            console.log(`Successfully imported ${insertedCount} words`);
            // 更新wordDatabase
            loadWordDatabase()
              .then(() => {
                res.json({ message: `Successfully imported ${insertedCount} words` });
              })
              .catch(error => {
                console.error("Error updating wordDatabase:", error);
                res.status(500).json({ error: 'Failed to update word database' });
              });
          }
        });
      });

      // 删除临时文件
      fs.unlinkSync(req.file.path);
    });
});

app.get('/words', (req, res) => {
  console.log('Fetching words from database');
  res.json(wordDatabase);
});

app.post('/users', (req, res) => {
  const { username } = req.body;
  db.run("INSERT INTO users (username) VALUES (?)", [username], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(400).json({ error: 'Username already exists' });
      } else {
        res.status(500).json({ error: err.message });
      }
      return;
    }
    res.status(201).json({ id: this.lastID, username });
  });
});

// 修改错题库相关的路由
app.get('/error_bank/:userId', (req, res) => {
  const { userId } = req.params;
  db.all("SELECT w.*, e.error_count FROM words w JOIN error_bank e ON w.id = e.word_id WHERE e.user_id = ?", [userId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/error_bank/:userId', (req, res) => {
  const { userId } = req.params;
  const { word_id, increment } = req.body;
  db.run("INSERT OR REPLACE INTO error_bank (user_id, word_id, error_count) VALUES (?, ?, COALESCE((SELECT error_count FROM error_bank WHERE user_id = ? AND word_id = ?), 0) + ?)",
    [userId, word_id, userId, word_id, increment], (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ message: 'Error bank updated' });
    });
});

// 添加导出错题的路由
app.get('/export_error_bank/:userId', (req, res) => {
  const { userId } = req.params;
  db.all("SELECT w.en, w.zh, w.is_root, e.error_count FROM words w JOIN error_bank e ON w.id = e.word_id WHERE e.user_id = ?", [userId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const csv = rows.map(row => `${row.en},${row.zh},${row.is_root},${row.error_count}`).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=error_bank.csv');
    res.send(csv);
  });
});

app.post('/test_records', (req, res) => {
  const { user_id, score, total_questions } = req.body;
  db.run("INSERT INTO test_records (user_id, score, total_questions) VALUES (?, ?, ?)",
    [user_id, score, total_questions], (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ message: 'Test record saved' });
    });
});

let selectedWords = [];
let testMode = 'mixed'; // 默认为混合模式

// 添加新的路由
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.post('/save-selected-words', (req, res) => {
  selectedWords = req.body.selectedWords;
  testMode = req.body.testMode;
  res.json({ message: 'Selected words and test mode saved successfully' });
});

app.get('/get-selected-words', (req, res) => {
  res.json({
    words: selectedWords.map(id => wordDatabase.find(word => word.id === id)).filter(Boolean),
    testMode: testMode
  });
});

app.get('/statistics', (req, res) => {
  db.all("SELECT score, total_questions FROM test_records", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const totalTests = rows.length;
    const scores = rows.map(row => row.score / row.total_questions * 100);
    const averageScore = scores.reduce((a, b) => a + b, 0) / totalTests;
    const highestScore = Math.max(...scores);
    const lowestScore = Math.min(...scores);
    res.json({
      totalTests,
      averageScore,
      highestScore,
      lowestScore
    });
  });
});

let errorTestWords = [];

app.get('/error_management', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'error_management.html'));
});

app.get('/error_test', (req, res) => {
    console.log('Received request for /error_test');
    console.log('Request headers:', req.headers);
    console.log('Request query:', req.query);
    
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    
    try {
        const filePath = path.join(__dirname, 'public', 'error_test.html');
        console.log('Attempting to send file:', filePath);
        
        if (fs.existsSync(filePath)) {
            console.log('File exists, sending...');
            res.sendFile(filePath);
        } else {
            console.log('File does not exist');
            res.status(404).send('Error test page not found');
        }
    } catch (error) {
        console.error('Error serving error_test.html:', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/error_words', (req, res) => {
    console.log('Received request for /error_words');
    db.all("SELECT w.*, e.error_count FROM words w JOIN error_bank e ON w.id = e.word_id WHERE e.error_count > 0", (err, rows) => {
        if (err) {
            console.error("Error fetching error words:", err);
            res.status(500).json({ error: err.message });
            return;
        }
        console.log(`Fetched ${rows.length} error words`);
        console.log("Error words:", rows);
        res.json(rows);
    });
});

app.post('/save-error-test-words', (req, res) => {
    errorTestWords = req.body.selectedWords;
    res.json({ success: true });
});

app.get('/get-error-test-words', (req, res) => {
    db.all("SELECT * FROM words WHERE id IN (" + errorTestWords.join(',') + ")", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 添加清除错题库的路由
app.get('/check-error-bank', (req, res) => {
    const userId = 1; // 假设用户ID为1
    console.log('Checking error bank for user:', userId);
    
    db.all("SELECT * FROM error_bank WHERE user_id = ?", [userId], (err, rows) => {
        if (err) {
            console.error("Error checking error bank:", err);
            res.status(500).json({ error: err.message });
            return;
        }
        console.log("Error bank contents:", rows);
        res.json(rows);
    });
});

// 修改更新错题的路由
app.post('/update-error-word', (req, res) => {
    const { wordId, isCorrect } = req.body;
    const userId = 1; // 假设用户ID为1，实际应用中应该从会话或认证中获取
    console.log('Updating error word:', { wordId, isCorrect, userId });

    db.run(`INSERT INTO error_bank (user_id, word_id, error_count, correct_count)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, word_id) DO UPDATE SET
            error_count = error_count + CASE WHEN ? = 0 THEN 1 ELSE 0 END,
            correct_count = correct_count + CASE WHEN ? = 1 THEN 1 ELSE 0 END`, 
            [userId, wordId, isCorrect ? 0 : 1, isCorrect ? 1 : 0, isCorrect, isCorrect], (err) => {
        if (err) {
            console.error("Error updating error bank:", err);
            res.status(500).json({ success: false, error: err.message });
            return;
        }
        console.log(`${isCorrect ? 'Correct' : 'Error'} count updated for word:`, wordId);
        res.json({ success: true });
    });
});

// 修改获取错题的路由
app.get('/get-selected-error-words', (req, res) => {
    console.log('Received request for /get-selected-error-words');
    const userId = 1; // 假设用户ID为1，实际应用中应该从会话或认证中获取
    console.log('Fetching selected error words for user:', userId);
    
    db.all("SELECT w.* FROM words w JOIN error_bank e ON w.id = e.word_id WHERE e.user_id = ? AND e.error_count > 0", [userId], (err, rows) => {
        if (err) {
            console.error("Error fetching error words:", err);
            res.status(500).json({ error: err.message });
            return;
        }
        console.log("Fetched error words:", rows);
        res.json(rows);
    });
});

let selectedErrorWords = [];

app.post('/save-selected-error-words', (req, res) => {
    selectedErrorWords = req.body.selectedErrorWords;
    res.json({ success: true });
});

app.get('/get-selected-error-words', (req, res) => {
    db.all("SELECT * FROM words WHERE id IN (" + selectedErrorWords.join(',') + ")", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/get-error-words', (req, res) => {
    const userId = 1; // 假设用户ID为1，实际应用中应该从会话或认证中获取
    db.all("SELECT w.* FROM words w JOIN error_bank e ON w.id = e.word_id WHERE e.user_id = ? AND e.error_count > 0", [userId], (err, rows) => {
        if (err) {
            console.error("Error fetching error words:", err);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 添加一个新的路由来检查错题库的内容
app.get('/check-error-bank', (req, res) => {
    const userId = 1; // 假设用户ID为1
    console.log('Checking error bank for user:', userId);
    
    db.all("SELECT * FROM error_bank WHERE user_id = ?", [userId], (err, rows) => {
        if (err) {
            console.error("Error checking error bank:", err);
            res.status(500).json({ error: err.message });
            return;
        }
        console.log("Error bank contents:", rows);
        res.json(rows);
    });
});

// 在服务器启动时，检查错题库表是否存在，如果不存在则创建
db.run(`CREATE TABLE IF NOT EXISTS error_bank (
    user_id INTEGER,
    word_id INTEGER,
    error_count INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, word_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(word_id) REFERENCES words(id)
)`, (err) => {
    if (err) {
        console.error("Error creating error_bank table:", err);
    } else {
        console.log("error_bank table created or already exists");
    }
});

app.get('/debug-error-bank', (req, res) => {
    db.all("SELECT * FROM error_bank", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Available routes:');
  console.log('  GET  /error_test');
  console.log('  GET  /get-selected-error-words');
  console.log('  POST /update-error-word');
  console.log('  GET  /check-error-bank');
  // 列出其他重要路由...
});