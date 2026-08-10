import type { Book } from "../../types/Books";
import BookSpine from "./BookSpine";

type BookColumnProps = {
    book : Book;
    showYear  : boolean;
    showMonth : boolean;
};

function BookColumn({
    book,
    showYear,
    showMonth
} : BookColumnProps) {

    const[year, month] = book.read_date?.split("-") ?? ["",""];
    
    return(
        <section className="book-column">
            <div className={`read-year ${showYear ? "" : "is-hidden"}`}>{year}</div>
            <div className={`read-month ${showMonth ? "" : "is-hidden"}`}>{Number(month)}月</div>
            <div className="month-books">
                <BookSpine
                    id={book.id}
                    title={book.title}
                    author={book.author}
                    rating={book.rating}
                    backgroundColor={book.category_color}
                />
            </div>
        </section>
    );
}

export default BookColumn;