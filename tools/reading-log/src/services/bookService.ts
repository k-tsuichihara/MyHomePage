import { supabase } from "../lib/supabase";
import type { Book } from "../types/Books";
import type { BookDetail } from "../types/BookDetail";
import type { Category } from "../types/Category";

// 時間表記調整
function formatDate(date: string | null): string | null{
    if(!date){
        return null;
    }

    return new Date(date).toLocaleDateString("ja-JP");
}

// カテゴリ取得
export async function getCategories(): Promise<Category[]>{
    const { data, error } = await supabase
        .from("reading_categories")
        .select("id, name, color")
        .order("display_order", {ascending: true});

    if(error){
        console.error(error);
        return [];
    }

    return data ?? [];
}

// 本一覧取得
export async function getBooks() : Promise<Book[]> {
    
    const {data : fetchedBooks, error} = await supabase
        .from("reading_books_public")
        .select("*");

    if(error) {
        console.error(error);
        return [];

    }

    return fetchedBooks ?? [];
}
// 本単品取得
export async function getBook(id: string): Promise<BookDetail | null>{
    const {data: fetchBook, error} = await supabase
        .from("reading_books")
        .select(`
            *,
            reading_categories (
                name,
                color
            )
            `)
        .eq("id",id)
        .single();
    
    if(error){
        console.error(error);
        return null;
    }
    if(!fetchBook){
        return null;
    }

    const book: BookDetail = {
        id   : fetchBook.id,
        isbn : fetchBook.isbn,
        title : fetchBook.title,
        author : fetchBook.author,
        category_id : fetchBook.category_id,
        status : fetchBook.status,
        read_date : fetchBook.read_date,
        rating : fetchBook.rating,
        memo : fetchBook.memo,
        impression : fetchBook.impression,
        cover_url : fetchBook.cover_url,
        created_at : formatDate(fetchBook.created_at),
        updated_at : formatDate(fetchBook.updated_at),
        category_name : fetchBook.reading_categories?.name ?? null,
        category_color : fetchBook.reading_categories?.color ?? null,
    };

    return book
}

// 公開用本の詳細取得
export async function getPublicBook(
    id: string
): Promise<BookDetail | null>{

    const { data: fetchedBook, error } = await supabase
        .from("reading_books_public")
        .select("*")
        .eq("id",id)
        .single();
    
        if(error){
            console.error("公開本取得エラー:", error)
            return null;
        }

        if(!fetchedBook){
            return null;
        }
        
        return {
            id: fetchedBook.id,
            isbn:"",
            title:fetchedBook.title,
            author:fetchedBook.author,
            category_id:fetchedBook.category_id,
            status:fetchedBook.status,
            read_date:fetchedBook.read_date,
            rating:fetchedBook.rating,
            cover_url: fetchedBook.cover_url,

            // 公開しない
            memo:null,
            impression:null,
            
            // viewにないのでnull
            created_at:null,
            updated_at:null,
            
            category_name:fetchedBook.category_name,
            category_color:fetchedBook.category_color

        };
}


// 本の更新処理
export async function updateBook(book: BookDetail){
    const { error } = await supabase
    .from("reading_books")
    .update({
        status: book.status,
        category_id: book.category_id,
        read_date: book.read_date,
        rating: book.rating,
        memo: book.memo,
        impression: book.impression,
        cover_url: book.cover_url,
        updated_at: new Date().toISOString(),
    })
    .eq("id", book.id)

    return { error };
}

// 本の登録処理
export async function createBook(book: BookDetail){
    const{ data, error } = await supabase
    .from("reading_books")
    .insert({
        isbn: book.isbn,
        title: book.title,
        author: book.author,
        category_id: book.category_id,
        status:book.status,
        read_date:book.read_date,
        rating:book.rating,
        memo: book.memo,
        impression:book.impression,
        cover_url:book.cover_url
    })
    .select()
    .single();

    return { data, error };
}

// 本の削除(論理削除)
export async function deleteBook(id: string){
    const { error } = await supabase
        .from("reading_books")
        .update({
            is_deleted: true,
            updated_at: new Date().toISOString(),
        })
        .eq("id",id);

    return {error};
}