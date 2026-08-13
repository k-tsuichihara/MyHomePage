import { useNavigate } from "react-router-dom";
import type { Book } from "../../types/Books";
import "./BookCoverList.css";

type BookCoverListProps = {
    books: Book[];
    shelfMode: "read" | "wishlist";
}

function BookCoverList({
    books,
    shelfMode
}: BookCoverListProps){
    const navigate = useNavigate();
    const targetBooks = books.filter((book) =>
        shelfMode === "read"
            ? book.status === "read"
            : book.status === "want_to_read"
    );

    return(
        <div className="book-cover-list">
            {targetBooks.map((book) => (
                <button
                    type="button"
                    key={book.id}
                    className="book-cover-list-item"
                    style={{
                        borderLeft: `8px solid ${book.category_color ?? "#ccc"}`
                    }}
                    onClick={() => navigate(`/books/${book.id}`)}
                >
                    <div className="book-cover-list-image">
                        {book.cover_url ? (
                            <img
                                src={book.cover_url}
                                alt={book.title}
                            />
                        ): (
                            <span>NO IMAGE</span>
                        )}
                    </div>
                    <div className="book-cover-list-info">
                        <div className="book-cover-list-title">
                            {book.title}
                        </div>
                        <div className="book-cover-list-author">
                            {book.author}
                        </div>
                    </div>
                    <div className="book-cover-list-date">
                        {book.status === "read" && book.read_date
                            ? book.read_date.replaceAll("-","/")
                            : ""}
                    </div>
                    <div className="book-cover-list-rating">
                        {book.rating !== null
                            ? `★${book.rating}`
                            : "-"
                        }
                    </div>
                </button>
            ))}
        </div>
    );
}

export default BookCoverList;
