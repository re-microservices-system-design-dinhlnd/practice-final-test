// Shared quiz engine
// Usage: define window.QUIZ_DATA = [ {q, options, answer, explanation, level}, ... ]
// then call renderQuiz()

(function () {
  let score = { correct: 0, wrong: 0, answered: 0 };

  function renderQuiz() {
    const container = document.getElementById('quiz-container');
    const data = window.QUIZ_DATA || [];
    container.innerHTML = '';
    score = { correct: 0, wrong: 0, answered: 0 };
    updateScore();

    data.forEach(function (item, idx) {
      const card = document.createElement('div');
      card.className = 'q-card';
      card.id = 'q-' + idx;

      const levelClass = item.level === 'Dễ' ? 'level-easy' : item.level === 'Khó' ? 'level-hard' : 'level-medium';

      let optionsHtml = item.options.map(function (opt, oi) {
        return '<li><button id="opt-' + idx + '-' + oi + '" onclick="selectAnswer(' + idx + ',' + oi + ')">' + escHtml(opt) + '</button></li>';
      }).join('');

      card.innerHTML =
        '<div class="q-num">Câu ' + (idx + 1) + ' / ' + data.length + '</div>' +
        '<span class="q-level ' + levelClass + '">' + item.level + '</span>' +
        '<div class="q-text">' + escHtml(item.q) + '</div>' +
        '<ul class="options">' + optionsHtml + '</ul>' +
        '<div class="explanation" id="exp-' + idx + '">' +
        '<strong>📖 Giải thích:</strong>' + escHtml(item.explanation) +
        '</div>';

      container.appendChild(card);
    });
  }

  window.selectAnswer = function (qIdx, optIdx) {
    const data = window.QUIZ_DATA;
    const item = data[qIdx];

    // Already answered?
    const correctBtn = document.getElementById('opt-' + qIdx + '-' + item.answer);
    if (correctBtn.disabled) return;

    score.answered++;
    const chosen = document.getElementById('opt-' + qIdx + '-' + optIdx);

    // Disable all options for this question
    for (let i = 0; i < item.options.length; i++) {
      document.getElementById('opt-' + qIdx + '-' + i).disabled = true;
    }

    if (optIdx === item.answer) {
      score.correct++;
      chosen.classList.add('correct-ans');
    } else {
      score.wrong++;
      chosen.classList.add('wrong-ans');
      correctBtn.classList.add('correct-ans');
    }

    document.getElementById('exp-' + qIdx).classList.add('show');
    updateScore();
  };

  function updateScore() {
    document.getElementById('score-correct').textContent = score.correct;
    document.getElementById('score-wrong').textContent = score.wrong;
    document.getElementById('score-answered').textContent = score.answered;
    document.getElementById('score-total').textContent = (window.QUIZ_DATA || []).length;
  }

  window.resetQuiz = function () {
    renderQuiz();
  };

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  // Auto-init
  document.addEventListener('DOMContentLoaded', renderQuiz);
})();
