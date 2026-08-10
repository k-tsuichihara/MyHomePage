type SearchInputProps = {
    keyword : string;
    onKeywordChange : (value: string) => void;
};

function SerachInput({
    keyword,
    onKeywordChange,
} :SearchInputProps) {
    return(
        <div className="search-input-area">
            <input
              className="search-input"
              type="text"
              value={keyword}
              onChange={(event) =>
                    onKeywordChange(event.target.value)
              }
              placeholder="タイトル・著者名を入力"
            />
        </div>
    );
}

export default SerachInput;