var $window = $(window);
var $year = $('#js-year');
var $month = $('#js-month');
var $tbody = $('#js-calendar-body');

var today = new Date();
var currentYear = today.getFullYear(),
    currentMonth = today.getMonth();

$window.on('load',function(){
  calendarHeading(currentYear, currentMonth);
  calendarBody(currentYear, currentMonth, today);
});

function calendarBody(year, month, today){
  var todayYMFlag = today.getFullYear() === year && today.getMonth() === month ? true : false; // 本日の年と月が表示されるカレンダーと同じか判定
  var startDate = new Date(year, month, 1); // その月の最初の日の情報
  var endDate  = new Date(year, month + 1 , 0); // その月の最後の日の情報
  var startDay = startDate.getDay();// その月の最初の日の曜日を取得
  var endDay = endDate.getDate();// その月の最後の日の曜日を取得
  var textSkip = true; // 日にちを埋める用のフラグ
  var textDate = 1; // 日付(これがカウントアップされます)
  var tableBody =''; // テーブルのHTMLを格納する変数
  
  for (var row = 0; row < 6; row++){
    var tr = '<tr>';
    
    for (var col = 0; col < 7; col++) {
      if (row === 0 && startDay === col){
        textSkip = false;
      }
      if (textDate > endDay) {
        textSkip = true;
      }
      var addClass = todayYMFlag && textDate === today.getDate() ? 'is-today' : '';
      var textTd = textSkip ? '&nbsp;' : textDate++;
      var td = '<td class="'+addClass+'">'+textTd+'</td>';
      tr += td;
    }
    tr += '</tr>';
    tableBody += tr;
  }
  $tbody.html(tableBody);
}

function calendarHeading(year, month){
  $year.text(year);
  $month.text(month + 1);
}