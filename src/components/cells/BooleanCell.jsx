import React from 'react';

const styles = {
    root: {
        position: 'relative',
        padding: '0 20px',
        display: 'flex',
        width: '100%',
        alignItems: 'center'
    },
    img: {
        width: 32,
        height:32,
    },
}


const Cell = ({tableManager, value, onChange, isEdit, data, column, rowIndex, searchText, isFirstEditableCell}) => {
    return (
        <div style={styles.root}>
            {value && <img alt="" style={styles.img} src={process.env.PUBLIC_URL+"/image/yes.png"}/>}
        </div>
    )
}

export default Cell;