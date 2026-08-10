import {useEffect, useState} from "react";
import type { Book } from "../types/Books";
import { getBooks } from "../services/bookService";
import { supabase } from "../lib/supabase";
import { logout } from "../services/authService"; 


import AppHeader from "../components/common/AppHeader";
import MainPageHeader from "../components/main/MainPageHeader";
import SearchArea from "../components/main/SearchArea";
import BookShelf from "../components/main/BookShelf";
import FooterMenu from "../components/main/FooterMenu";
import Statistics from "../components/main/Statistics";
import AppFooter from  "../components/common/AppFooter";
import LoginModal from "./LoginModal";
import "../index.css";

function MainPage(){
    // 本の型
    const [books, setBooks] = useState<Book[]>([]);
    const [shelfMode, setShelfMode] = useState<"read" | "wishlist">("read");
    // 検索条件用
    const [keyword, setKeyword] = useState("");
    const [rating, setRating] = useState("");
    const [sortOrder, setSortOrder] = useState("read_date_desc");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const handleClear = () => {
        setKeyword("");
        setRating("");
        setSortOrder("read_date_desc");
        setStartDate("");
        setEndDate("");
    };

    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const handleLogout = async() => {
        const { error } = await logout();

        if(error){
            alert(error.message);
            return;
        }

    };

    // 画面を開いたタイミングで処理
    useEffect(() => {
        async function loadBooks(){
            const fetchedBooks = await getBooks();
            setBooks(fetchedBooks);
        }

        loadBooks();
    }, []);

    // ログイン状況監視用
    useEffect(() => {
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setIsLoggedIn(session !== null);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    // 検索機能（絞り込み）
    const filterBooks = books.filter((book) => {

        // タイトル・著者
        if(
            keyword !== "" &&
            !book.title.includes(keyword) &&
            !book.author.includes(keyword)
        ){
            return false;
        }
        // 評価
        if (rating !== "") {
            // 未評価
            if (rating === "none") {
                if (book.rating !== null) {
                    return false;
                }
            }
            // ★1～5
            else if (book.rating !== Number(rating)) {
                return false;
            }
        }
        // 開始日
        if(
            startDate !== "" &&
            book.read_date !== null &&
            book.read_date < startDate
        ){
            return false;
        }
        // 終了日
        if(
            endDate !== "" &&
            book.read_date !== null &&
            book.read_date > endDate
        ){
            return false;
        }

        return true;
    });

    // 検索機能（並び替え）
    const sortedBooks = [...filterBooks];

    switch(sortOrder){
        
        case "read_date_desc":
            sortedBooks.sort((a, b) =>
            (b.read_date ?? "").localeCompare(a.read_date ?? "")
        );
        break;

        case "read_date_asc":
            sortedBooks.sort((a, b) =>
                (a.read_date ?? "").localeCompare(b.read_date ?? "")
            );
            break;

        case "rating_desc":
            sortedBooks.sort((a, b) =>
                (b.rating ?? 0) - (a.rating ?? 0)
            );
            break;

        case "rating_asc":
            sortedBooks.sort((a, b) =>
                (a.rating ?? 0) - (b.rating ?? 0)
            );
            break;

        case "author_asc":
            sortedBooks.sort((a, b) =>
                a.author.localeCompare(b.author)
            );
            break;        
    };

    return(
        <>
        {/* ヘッダ */}
        <AppHeader />
        {/* 中央画面 */}
        <main>
            <MainPageHeader 
                bookCount={books.filter((book) => book.status === "read").length}
                isLoggedIn={isLoggedIn}
                onLoginClick={() => setIsLoginModalOpen(true)}
                onLogoutClick={handleLogout}
            />
            <SearchArea 
                keyword={keyword}
                onKeywordChange={setKeyword}
                rating={rating}
                onRatingChange={setRating}
                sortOrder={sortOrder}
                onSortOrderChange={setSortOrder}
                startDate={startDate}
                onStartDateChange={setStartDate}
                endDate={endDate}
                onEndDateChange={setEndDate}
                onClear={handleClear}
            />
            <BookShelf 
                books={sortedBooks} 
                shelfMode={shelfMode}
            />
            <FooterMenu
                shelfMode={shelfMode}
                onShelfModeChange={setShelfMode}
                isLoggedIn={isLoggedIn}
            />
        </main>
        {/* 履歴 */}
        <Statistics books={books}/>
        {/* フッタ */}
        <AppFooter />
        {/* ログインモーダル */}
        {isLoginModalOpen && (
            <LoginModal
                onClose={() => setIsLoginModalOpen(false)}
            />
        )}
        </>
    );

}

export default MainPage;