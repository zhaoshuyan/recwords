let currentUser = null;
let wordDatabase = [];
let selectedWords = [];
let currentWords = [];
let currentQuestion = null;
let score = 0;
let totalQuestions = 0;
let currentPage = 1;
const wordsPerPage = 20;
let showingRootWords = false;
let errorBank = {};
let showingErrorBank = false;

function createUser() {
    const username = document.getElementById('username').value;
    if (!username) {
        alert('请输入用户名');
        return;
    }
    fetch('/users', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: username }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            currentUser = data;
            document.getElementById('user-selection').style.display = 'none';
            document.getElementById('word-import').style.display = 'block';
            document.getElementById('word-selection').style.display = 'block';
            loadWords();
        }
    });
}

function importWords() {
    const fileInput = document.getElementById('excel-file');
    const file = fileInput.files[0];
    if (!file) {
        alert('请选择一个Excel文件');
        return;
    }
    const formData = new FormData();
    formData.append('file', file);
    fetch('/import_words', {
        method: 'POST',
        body: formData,
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            alert(data.message);
            loadWords();
        }
    });
}

function loadWords() {
    fetch('/words')
    .then(response => response.json())
    .then(data => {
        wordDatabase = data;
        initializeWordList();
    });
}

function initializeWordList() {
    const wordList = document.getElementById('word-list');
    wordList.innerHTML = '';
    const startIndex = (currentPage - 1) * wordsPerPage;
    const endIndex = startIndex + wordsPerPage;
    const currentWords = wordDatabase.filter(word => word.is_root === showingRootWords).slice(startIndex, endIndex);

    currentWords.forEach(word => {
        const wordItem = document.createElement('div');
        wordItem.className = `word-item ${word.is_root ? 'root' : ''}`;
        wordItem.textContent = word.en;
        wordItem.onclick = () => toggleWordSelection(word.id, wordItem);
        wordList.appendChild(wordItem);
    });

    updatePageInfo();
}

function updatePageInfo() {
    const totalWords = wordDatabase.filter(word => word.is_root === showingRootWords).length;
    const totalPages = Math.ceil(totalWords / wordsPerPage);
    document.getElementById('page-info').textContent = `第 ${currentPage} 页，共 ${totalPages} 页`;
}

function changePage(delta) {
    const totalWords = wordDatabase.filter(word => word.is_root === showingRootWords).length;
    const totalPages = Math.ceil(totalWords / wordsPerPage);
    currentPage = Math.max(1, Math.min(currentPage + delta, totalPages));
    initializeWordList();
}

function toggleRootWords() {
    showingRootWords = !showingRootWords;
    currentPage = 1;
    initializeWordList();
}

function toggleErrorBank() {
    showingErrorBank = !showingErrorBank;
    document.getElementById('word-selection').style.display = showingErrorBank ? 'none' : 'block';
    document.getElementById('error-bank').style.display = showingErrorBank ? 'block' : 'none';
    if (showingErrorBank) {
        updateErrorBankDisplay();
    }
}

function updateErrorBankDisplay() {
    fetch(`/error_bank/${currentUser.id}`)
    .then(response => response.json())
    .then(data => {
        errorBank = data;
        const errorWordList = document.getElementById('error-word-list');
        errorWordList.innerHTML = '';
        errorBank.forEach(word => {
            const wordItem = document.createElement('div');
            wordItem.className = 'word-item';
            wordItem.textContent = `${word.en} (错误次数: ${word.error_count})`;
            errorWordList.appendChild(wordItem);
        });
    });
}

function toggleWordSelection(wordId, element) {
    const index = selectedWords.indexOf(wordId);
    if (index > -1) {
        selectedWords.splice(index, 1);
        element.classList.remove('selected');
    } else {
        selectedWords.push(wordId);
        element.classList.add('selected');
    }
}

function startSelectedGame(mode) {
    if (selectedWords.length === 0) {
        alert('请至少选择一个单词！');
        return;
    }
    currentWords = wordDatabase.filter(word => selectedWords.includes(word.id));
    score = 0;
    totalQuestions = 0;
    nextQuestion(mode);
}

function startErrorBankGame() {
    currentWords = errorBank;
    if (currentWords.length === 0) {
        alert('错题库为空！');
        return;
    }
    score = 0;
    totalQuestions = 0;
    nextQuestion('mixed');
}

function nextQuestion(mode) {
    if (currentWords.length === 0) {
        endGame();
        return;
    }

    const index = Math.floor(Math.random() * currentWords.length);
    currentQuestion = currentWords[index];
    currentWords.splice(index, 1);

    let questionHtml = '';
    if (mode === 'en-to-zh' || (mode === 'mixed' && Math.random() < 0.5)) {
        questionHtml = `
            <h2>请选择"${currentQuestion.en}"的中文含义：</h2>
            ${generateOptions('zh')}
        `;
    } else {
        questionHtml = `
            <h2>请选择"${currentQuestion.zh}"的英文单词：</h2>
            ${generateOptions('en')}
        `;
    }

    document.getElementById('game-container').innerHTML = questionHtml;
    totalQuestions++;
}

function generateOptions(lang) {
    const options = [currentQuestion[lang]];
    while (options.length < 4) {
        const randomWord = wordDatabase[Math.floor(Math.random() * wordDatabase.length)][lang];
        if (!options.includes(randomWord)) {
            options.push(randomWord);
        }
    }
    shuffleArray(options);

    return options.map((option, index) => 
        `<button onclick="checkAnswer('${option}')">${option}</button>`
    ).join('');
}

function checkAnswer(answer) {
    if (answer === currentQuestion.en || answer === currentQuestion.zh) {
        score++;
        alert('回答正确！');
        updateErrorBank(currentQuestion.id, -1);
    } else {
        alert(`回答错误。正确答案是：${currentQuestion.en} - ${currentQuestion.zh}`);
        updateErrorBank(currentQuestion.id, 1);
    }
    nextQuestion(document.querySelector('button[onclick^="startSelectedGame"]').getAttribute('onclick').includes('en-to-zh') ? 'en-to-zh' : 'zh-to-en');
}

function updateErrorBank(wordId, increment) {
    fetch(`/error_bank/${currentUser.id}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ word_id: wordId, increment: increment }),
    });
}

function endGame() {
    document.getElementById('game-container').innerHTML = `
        <h2>游戏结束！</h2>
        <p>你的得分是：${score} / ${totalQuestions}</p>
    `;
    saveTestRecord();
}

function saveTestRecord() {
    fetch('/test_records', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            user_id: currentUser.id,
            score: score,
            total_questions: totalQuestions,
        }),
    });
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// 初始化
loadWords();