let currentWords = [];
let currentQuestion = null;
let score = 0;
let totalQuestions = 0;

function startGame(mode) {
    const start = parseInt(document.getElementById('start').value);
    const end = parseInt(document.getElementById('end').value);
    currentWords = words.slice(start, end + 1);
    score = 0;
    totalQuestions = 0;
    nextQuestion(mode);
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
        const randomWord = words[Math.floor(Math.random() * words.length)][lang];
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
    } else {
        alert(`回答错误。正确答案是：${currentQuestion.en} - ${currentQuestion.zh}`);
    }
    nextQuestion(document.querySelector('button:disabled').textContent === '英译中' ? 'en-to-zh' : 'zh-to-en');
}

function endGame() {
    document.getElementById('game-container').innerHTML = `
        <h2>游戏结束！</h2>
        <p>你的得分是：${score} / ${totalQuestions}</p>
    `;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}