import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

import type { BookDetail } from "../types/BookDetail";
import type { Category } from "../types/Category";
import { getBook, updateBook, createBook, getCategories, deleteBook, getPublicBook } from "../services/bookService";
import AppHeader from "../components/common/AppHeader";
import BookForm from "../components/book/BookForm";
import ActionButton from "../components/book/ActionButtons";
import AppFooter from  "../components/common/AppFooter";

function BookDetailPage(){

    const emptyBook: BookDetail = {
        id : "",
        isbn : "",
        title: "",
        author: "",
        category_id: null,
        status: "read",
        read_date: null,
        rating: null,
        memo: null,
        impression: null,
        cover_url: null,
        created_at: null,
        updated_at: null,
        category_name:null,
        category_color:null
    };    
    const { id } = useParams();
    const navigate = useNavigate();
    const [categories, setCategories] = useState<Category[]>([]);
    const [book, setBook] = useState<BookDetail | null>(
        id === undefined ? emptyBook : null
    );
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const handleUpdate = async () => {
        if(!book){
            return;
        }
        if (book.status === "read" &&
            (book.read_date === null || book.rating === null)
        ) {
            alert("読了済みにする場合は、読了日と評価を入力してください。");
            return;
        }
        const { error } = await updateBook(book);

        if(error){
            alert("更新に失敗しました。")
            console.error("更新エラー:", error);
            console.error("code:", error.code);
            console.error("message:", error.message);
            console.error("details:", error.details);
            console.error("hint:", error.hint);
            return;
        }

        alert("更新しました。")
    }

    const handleAdd = async() => {
        if(!book){
            return;
        }

        if (
            book.title.trim() === "" ||
            book.author.trim() === ""
        ) {
            alert("タイトル・著者は入力必須です。");
            return;
        }

        if (
            book.status === "read" &&
            (book.rating === null || book.read_date === null)
        ) {
            alert("読了済みの本は評価・読了日の入力が必須です。");
            return;
        }

        const { data, error } = await createBook(book);

        if(error){
            alert("登録に失敗しました。")
            console.error("登録エラー:", error);
            console.error("code:", error.code);
            console.error("message:", error.message);
            console.error("details:", error.details);
            console.error("hint:", error.hint);
            return;
        }
        alert("登録しました。");
        navigate("/");
    }

    const handleDetele = async () => {
        if(!book){
            return;
        }

        const isConfirmed = window.confirm(
            `「${book.title}」を削除しますか？`
        );
        if(!isConfirmed){
            return;
        }

        const { error } = await deleteBook(book.id);

        if(error){
            console.error("削除エラー :" ,error);
            alert("削除に失敗しました。");
            return;
        }

        alert("削除しました");
        navigate("/");
    }

    useEffect(() => {
        async function loadBook(){
            //新規登録の場合はスルー
            if(!id){
                return;
            }

            const fetchedBook = isLoggedIn
                ? await getBook(id)
                : await getPublicBook(id);
            setBook(fetchedBook);
        }

        loadBook();
    }, [id, isLoggedIn]);

    useEffect(() => {
        const {
            data: {subscription},
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setIsLoggedIn(session !== null);
        });

        return() => {
            subscription.unsubscribe();
        }
    }, []);

    useEffect(() => {
        async function loadCategories(){
            const fetchedCategories = await getCategories();
            setCategories(fetchedCategories);
        }
        loadCategories();
    }, []);

    return(
        <>
            {/* ヘッダ */}
            <AppHeader />
            {/* 本体 */}
            <BookForm 
                book={book}
                onChange={setBook}
                isNew={id === undefined}
                categories={categories}
                isLoggedIn={isLoggedIn}
            />
            <ActionButton 
                isNew={id === undefined}
                isLoggedIn={isLoggedIn}
                onAdd={handleAdd}
                onUpdate={handleUpdate}
                onDelete={handleDetele}
            />
            {/* フッタ */}
            <AppFooter />
        </>
    );
}

export default BookDetailPage;