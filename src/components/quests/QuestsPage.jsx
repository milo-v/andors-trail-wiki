import React from 'react';
import QuestsTable from './QuestsTable.jsx';

export default class ItemsPage extends React.Component {
    render() {
        return (
            <div>
               
                    <QuestsTable
                        data = { this.props.data } title="Usable"
                        filter = {(e)=>(e.showInLog)&&(e.id!=="base_nondisplay")}
                    />

            </div> 
        );
    }
}

