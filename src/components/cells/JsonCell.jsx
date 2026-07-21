import React from 'react';

const styles = {
    root: {
        position: 'relative',
        padding: '0 20px',
        display: 'flex',
        width: '100%',
        height: '100%',
        alignItems: 'center'
    },
    text: {
        marginLeft: 10,
        margin: 'auto',
    },
}

const Cell = (...field)=>{
    return ({tableManager, value, onChange, isEdit, data, column, rowIndex, searchText, isFirstEditableCell}) => {
        var v = {data};
        field.forEach((f)=>{v.data = v.data[f]||{}});
        v=JSON.stringify(v.data);
        if (v==="{}") return "";
        return (
            <div style={styles.root}>
               <span style={styles.text}>{v}</span>
            </div>
        )

    }
}

export default Cell;