import type { Book } from "../../types/Books";
import { useState } from "react";
import "./Statistics.css";

type StatisticsProps = {
    books : Book[];
}

function Statistics({ books } :StatisticsProps) {

    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const monthlyCounts = Array(12).fill(0);
    const readDates = books.filter(
        (book) =>
            book.status === "read" && book.read_date !== null
        ).map((book) => book.read_date as string);
    const latestReadDate = 
        readDates.length > 0
            ? readDates.sort().at(-1)
            : null;

    // 12か月ごとに本の数を集計
    for(const book of books){
        if(book.status !== "read" || book.read_date === null){
            continue;
        }

        const [year, month] = book.read_date.split("-");

        if(Number(year) !== selectedYear){
            continue;
        }

        monthlyCounts[Number(month) - 1]++;

    }

    // 最後の読了日を計算する
    let daysSinceLastRead: number | null = null;

    if(latestReadDate !== null){

        const today = new Date();
        const lastReadDate = new Date(`${latestReadDate}T00:00:00`);

        const differenceMs =
            today.getTime() - lastReadDate.getTime();

        daysSinceLastRead = Math.floor(
            differenceMs / (1000*60*60*24)
        );
    }

    return(
        <section className="statistics">
            <div className="inside-padding statistics-year">
                <button className="year-button" type="button" onClick={() => setSelectedYear(selectedYear - 1)}>⇐</button>
                <span>{selectedYear}</span>
                <button className="year-button" type="button" onClick={() => setSelectedYear(selectedYear + 1)}>⇒</button>
            </div>
            <div className="monthly-counts">
                <div className="month-column">
                    <div><span>1月</span><span>{monthlyCounts[0]}冊</span></div>
                    <div><span>2月</span><span>{monthlyCounts[1]}冊</span></div>
                    <div><span>3月</span><span>{monthlyCounts[2]}冊</span></div>
                    <div><span>4月</span><span>{monthlyCounts[3]}冊</span></div>
                    <div><span>5月</span><span>{monthlyCounts[4]}冊</span></div>
                    <div><span>6月</span><span>{monthlyCounts[5]}冊</span></div>
                </div>
                <div className="month-column">
                    <div><span>7月</span><span>{monthlyCounts[6]}冊</span></div>
                    <div><span>8月</span><span>{monthlyCounts[7]}冊</span></div>
                    <div><span>9月</span><span>{monthlyCounts[8]}冊</span></div>
                    <div><span>10月</span><span>{monthlyCounts[9]}冊</span></div>
                    <div><span>11月</span><span>{monthlyCounts[10]}冊</span></div>
                    <div><span>12月</span><span>{monthlyCounts[11]}冊</span></div>
                </div>
            </div>
            <div className="inside-padding last-read-days">
                <div className="last-read-title">最終読了日から...</div>
                <div className="read-day">{daysSinceLastRead !== null ? `${daysSinceLastRead}日` : "-"}</div>
            </div>
        </section>
    );

}

export default Statistics;