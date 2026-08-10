# フォルダ構成

src/  
├── components/  
│   ├── common/  
│   │   └── AppHeader.tsx  
│   │  
│   ├── main/  
│   │   ├── MainPageHeader.tsx  
│   │   ├── SearchArea.tsx  
│   │   ├── SearchInput.tsx  
│   │   ├── FilterControls.tsx  
│   │   ├── BookShelf.tsx  
│   │   ├── BookSpine.tsx  
│   │   ├── FooterMenu.tsx  
│   │   └── Statistics.tsx  
│   │  
│   └── book/  
│       ├── BookForm.tsx  
│       └── ActionButtons.tsx  
│  
├── pages/  
│   ├── MainPage.tsx  
│   ├── BookDetailPage.tsx  
│   └── LoginPage.tsx  
│  
├── types/  
│  
├── App.tsx  
└── main.tsx  

## components / common
全ページ共通で利用するコンポーネント

## components / main
メイン画面専用コンポーネント

## components / book
詳細画面専用コンポーネント

## pages
画面

## types
ユーザー変数

# 設計方針

- ページはURL単位で管理する
- 共通部品はcommonへ。
- コンポーネントは各画面ごとのフォルダ配下に置くこと
- 型定義はtypesへ。

# SearchAreaについて

SearchAreaは検索全体を管理する。

SearchInput
FilterControls

を内包する。

将来的に検索条件が増えても
SearchAreaが親になる設計とする。

## 共通CSSの管理

### 課題
既存サイトとReactアプリでstyle.cssを共有したかった。

### 解決方法
Windowsのジャンクションを利用して
public/common-cssを作成。

開発時
/common-css/style.css

公開時
../../css/style.css

.envで切り替える。