import type { Book } from "../../types/Books";

import BookColumn from "./BookColumn";
import "./BookShelf.css";

// 値の受け取り口
type BookShelfProps = {
    books : Book[];
    shelfMode : "read" | "wishlist";
};

function BookShelf({ books, shelfMode }: BookShelfProps){

    const readBooks : Book[] = [];
    const wishlistBooks : Book[] = [];                // 読みたい本一覧
    for(const book of books){
        
        // 読みたい本一覧は別に分ける（読了日がないので）
        if (book.status === "want_to_read"){
            wishlistBooks.push(book);
            continue;
        }

        // 読了日がないケースも別に分ける（基本的にはない想定）
        if (book.read_date === null){
            continue;
        }

        // 本をプッシュ
        readBooks.push(book);
    }

    const displayBooks =
        shelfMode === "read"
            ? readBooks
            : wishlistBooks;

    return(
        <section className="book-shelf">
            <div className="shelf-scroll">
                {displayBooks.map((book, index) => {

                    if(shelfMode === "wishlist"){
                        return(
                            <BookColumn
                                key={book.id}
                                book={book}
                                showYear={false}
                                showMonth={false}
                            />
                        );
                    }
                    
                    const currentDate = book.read_date!;
                    const previousDate = 
                        index > 0
                            ? displayBooks[index - 1].read_date
                            : null;
                    const [currentYear, currentMonth] = currentDate.split("-");
                    const [previousYear, previousMonth] = previousDate?.split("-") ?? ["",""];
                    const showYear = 
                        index === 0 || currentYear !== previousYear;
                    const showMonth =
                        index === 0 || currentYear !== previousYear || currentMonth !== previousMonth;

                    return(
                        <BookColumn
                            key = {book.id}
                            book = {book}
                            showYear = {showYear}
                            showMonth = {showMonth}
                        />
                    );
                })}
            </div>
        </section>
    );
}

export default BookShelf;
