import { useState } from "react";
import type { BookDetail } from "../../types/BookDetail";
import type { Category } from "../../types/Category";
import RatingInput from "../book/RatingInput";
import "./BookForm.css";
import TextEditModal from "../../pages/TextEditModal";
import BookSearchModal from "../../pages/BookSearchModal";
import type {BookSearchResult } from "../../types/BookSearchResult";

type BookFormProps = {
    book: BookDetail | null;
    onChange: (book: BookDetail) => void;
    isNew: boolean;
    categories: Category[];
    isLoggedIn:boolean;
};

function BookForm({ book, onChange, isNew, categories, isLoggedIn }: BookFormProps){
    
    const isRead = book?.status === "read";
    const [editingField, setEditingField] = useState<"memo" | "impression" | null>(null);
    const canChangeStatus =
        isLoggedIn &&
        (isNew || book?.status === "want_to_read");
    const [ isSearchModalOpen, setIsSearchModalOpen ] = useState(false);

    return(
        <div className="book-form-area">
            <div className="book-main-area">
                <div className="book-detail-area">
                    <div 
                        className="book-cover"
                        onClick={() => {
                            if(isLoggedIn){
                                setIsSearchModalOpen(true);
                            }
                        }}
                    >
                        {book?.cover_url ? (
                            <img
                                src={book.cover_url}
                                alt={book.title}
                            />
                        ) : (
                            "NO IMAGE"
                        )}
                    </div>
                    <div className="book-detail">
                        <div className="detail-row">
                            <div className="detail-label">タイトル</div>
                            <div className="detail-value">
                                {isNew ? (
                                    <input
                                        type="text"
                                        value={book?.title ?? ""}
                                        onChange={(e) => {
                                            if(book){
                                                onChange({
                                                    ...book,
                                                    title: e.target.value
                                                });
                                            }
                                        }}
                                    />
                                ) : (
                                    book?.title ?? ""
                                )}
                            </div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-label">著者</div>
                            <div className="detail-value">
                                {isNew ? (
                                    <input
                                        type="text"
                                        value={book?.author ?? ""}
                                        onChange={(e) => {
                                            if(book){
                                                onChange({
                                                    ...book,
                                                    author: e.target.value
                                                });
                                            }
                                        }}
                                    />
                                ) : (
                                    book?.author ?? ""
                                )}
                            </div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-label">種別</div>
                            <div className="detail-value">
                                {canChangeStatus ? (
                                    <select
                                        value={book?.status ?? "read"}
                                        onChange={(e) => {
                                            if(!book){
                                                return;
                                            }
                                            onChange({
                                                ...book,
                                                status: e.target.value
                                            })
                                        }}
                                    >
                                        <option value="read">読了</option>
                                        <option value="want_to_read">読みたい</option>
                                    </select>
                                ) : (
                                    book?.status === "want_to_read"
                                        ? "読みたい"
                                        : "読了"
                                )}
                            </div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-label">カテゴリ</div>
                            <div className="detail-value">
                                {isLoggedIn ? (
                                    <select
                                        value={book?.category_id ?? ""}
                                        onChange={(e) => {
                                            if(!book){
                                                return;
                                            }
                                            const selectedId = 
                                                e.target.value === ""
                                                    ? null
                                                    : Number(e.target.value);
                                            
                                            const selectedCategory =
                                                categories.find(
                                                    (category) => category.id === selectedId
                                                );
                                            
                                            onChange({
                                                ...book,
                                                category_id: selectedId,
                                                category_name: selectedCategory?.name ?? null,
                                                category_color: selectedCategory?.color ?? null,
                                            });

                                        }}
                                    >
                                        <option value = "">未選択</option>
                                        {categories.map((category) => (
                                            <option
                                                key={category.id}
                                                value={category.id}
                                            >
                                                {category.name}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    book?.category_name ?? ""
                                )}
                            </div>
                        </div>
                            {isRead && 
                            <div className="detail-row">
                                <div className="detail-label">読了日</div>
                                <div className="detail-value">
                                    {isLoggedIn ? (
                                        <input
                                            type="date"
                                            value={book?.read_date ?? ""}
                                            onChange={(e) => {
                                                if(book){
                                                    onChange({
                                                        ...book,
                                                        read_date
                                                        : e.target.value === "" 
                                                        ? null : e.target.value
                                                    });
                                                }
                                            }}
                                        />
                                    ) : book?.read_date ?? ""}
                                </div>
                            </div>                        
                        }
                        <div className="detail-row">
                            <div className="detail-label">作成日</div>
                            <div className="detail-value">
                                {book?.created_at ?? ""}
                            </div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-label">更新日</div>
                            <div className="detail-value">
                                {book?.updated_at ?? ""}
                            </div>
                        </div>
                    </div>
                </div>
                {isRead && (
                    <div className="book-rating-area">
                        <div className="rating-title">評価</div>
                        <div className="rating">
                            <RatingInput
                                value={book?.rating ?? null}
                                disabled={!isLoggedIn}
                                onChange={(newRating) => {
                                    if(book){
                                        onChange({
                                            ...book,
                                            rating: newRating,
                                        })
                                    }
                                }}
                            />
                        </div>
                    </div>
                )}

                {isLoggedIn && (
                    <div className="input-area">
                        <div className="input-title">メモ</div>
                        <div className="imput-area">
                            {/* PC */}
                            <textarea
                                className="memoimp-input pc-text-input"
                                value={book?.memo ?? ""}
                                onChange={(e) => {
                                    if(book){
                                        onChange({
                                            ...book,
                                            memo: e.target.value
                                        })
                                    }
                                }}
                                placeholder="メモを入力"
                            />
                            {/* スマホ */}
                            <button
                                type="button"
                                className={`text-preview mobile-text-input ${
                                    book?.memo === "" ? "empty" : ""
                                }`}
                                onClick={() => setEditingField("memo")} 
                            >
                                {book?.memo || "メモを入力"}
                            </button>
                        </div>
                        <div className="input-title">感想</div>
                        <div className="imput-area">
                            {/* PC */}
                            <textarea
                                className="memoimp-input pc-text-input"
                                value={book?.impression ?? ""}
                                onChange={(e) => {
                                    if(book){
                                        onChange({
                                            ...book,
                                            impression: e.target.value
                                        })
                                    }
                                }}
                                placeholder="感想を入力"
                            />
                            {/* スマホ */}
                            <button
                                type="button"
                                className={`text-preview mobile-text-input ${
                                    book?.impression === "" ? "empty" : ""
                                }`}
                                onClick={() => setEditingField("impression")} 
                            >
                                {book?.impression || "感想を入力"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            {/* テキストモーダル */}
            {isLoggedIn && editingField === "memo" && (
                <TextEditModal
                    title="メモ"
                    value={book?.memo ?? ""}
                    onChange={(value) => {
                        if(book){
                            onChange({
                                ...book,
                                memo: value,
                            });
                        }
                    }}
                    onClose={() => setEditingField(null)}
                />
            )}
            {isLoggedIn && editingField === "impression" && (
                <TextEditModal
                    title="感想"
                    value={book?.impression ?? ""}
                    onChange={(value) => {
                        if(book){
                            onChange({
                                ...book,
                                impression: value,
                            });
                        }
                    }}
                    onClose={() => setEditingField(null)}
                />
            )}
            {/* 本の表紙モーダル */}
            {isLoggedIn && isSearchModalOpen && (
                <BookSearchModal
                    onSelect={(result: BookSearchResult) => {
                        if(!book){
                            return;
                        }
                        if(isNew){
                            onChange({
                                ...book,
                                title: result.title || book.title,
                                author: result.author || book.author,
                                isbn: result.isbn ?? book.isbn,
                                cover_url:result.cover_url
                            });
                        } else{
                            onChange({
                                ...book,
                                cover_url:result.cover_url
                            });
                        }
                        setIsSearchModalOpen(false);
                    }}
                    onClearCover={() => {
                        if(!book){
                            return;
                        }
                        onChange({
                            ...book,
                            cover_url:null,
                        })
                    }}
                    onClose={() => setIsSearchModalOpen(false)}
                    hasCover={!!book?.cover_url}
                />
            )}
        </div>
    );

}
export default BookForm;